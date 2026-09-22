/**
 * Finalisation métier commune d'un appel vocal.
 *
 * Un appel doit produire un résultat exploitable même si l'appelant raccroche
 * au milieu du dialogue, si le WebSocket tombe, ou si le webhook de fin
 * n'arrive jamais. Les trois chemins existants (raccrochage Telnyx, fermeture
 * du stream, route `/voice/telnyx/end`) convergent donc ici, avec un rattrapage
 * en worker pour les appels restés incomplets.
 *
 * Règles de robustesse :
 *  - l'écriture est idempotente et rejouable (verrou de ligne + upsert) ;
 *  - les événements peuvent arriver dans le désordre : l'outcome ne régresse
 *    jamais, et une valeur vide n'écrase pas une valeur complète ;
 *  - le résultat est déduit des faits persistés (réservation réellement
 *    créée, transfert accepté, message enregistré) et non de l'intention
 *    exprimée par l'appelant ;
 *  - la récupération commerciale n'est déclenchée que si aucune réservation
 *    n'existe, une seule fois, selon les règles d'éligibilité existantes.
 */

import { Prisma, type CallIntent, type CallOutcome } from '@prisma/client';
import { CARTESIA_MODEL } from '@sokar/config';
import { db } from '../../shared/db/client';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../shared/db/transaction-options';
import { logger } from '../../shared/logger/pino';
import { captureException } from '../../shared/sentry/client';
import { getVoiceLlmProvider } from './llm-provider';
import { hadReservationIntent } from './outcome';

export type VoiceFinalizationSource =
  | 'hangup'
  | 'stream-close'
  | 'stream-error'
  | 'end-webhook'
  | 'sweep';

/** Faits observés hors base, fournis par le pipeline en mémoire. */
export interface VoiceFinalizationHints {
  source: VoiceFinalizationSource;
  /** Résolu depuis le numéro Telnyx `to` quand le webhook ne le porte pas. */
  restaurantId?: string | null;
  transcript?: string | null;
  endedReason?: string | null;
  durationSec?: number | null;
  sttProvider?: string | null;
  llmProvider?: string | null;
  ttsProvider?: string | null;
  /** Conclusion du dernier transfert tenté (`manager_transfer_accepted`, …). */
  handoffConclusion?: string | null;
  /** Intention de dialogue suivie en mémoire (`reservation`, `cancel`, …). */
  conversationIntent?: string | null;
  /** Numéro Telnyx appelé, utilisé pour retrouver le restaurant. */
  to?: string | null;
  /** Numéro de l'appelant, requis pour la récupération commerciale. */
  customerPhone?: string | null;
  customerName?: string | null;
}

export interface VoiceCallFacts {
  reservationCreated: boolean;
  handoffAccepted: boolean;
  handoffFailed: boolean;
  messageRecorded: boolean;
  reservationIntent: boolean;
  informational: boolean;
  errored: boolean;
}

export interface VoiceFinalizationResult {
  callSid: string;
  callId: string | null;
  created: boolean;
  /** Champs réellement écrits ; vide quand l'appel était déjà complet. */
  updatedFields: string[];
  outcome: CallOutcome | null;
  intent: CallIntent | null;
  facts: VoiceCallFacts;
  /** Renseigné quand la finalisation n'a pas pu s'appliquer. */
  skippedReason?: 'unknown_restaurant';
}

/**
 * Force de chaque outcome : une valeur plus forte ne peut jamais être
 * remplacée par une plus faible. `INFO` reste au-dessus d'`ERROR` pour qu'une
 * panne de transport tardive n'efface pas la nature réelle de l'appel.
 */
const OUTCOME_RANK: Record<CallOutcome, number> = {
  NO_ACTION: 1,
  ERROR: 2,
  INFO: 3,
  // Un message enregistré est un aboutissement métier, au même titre qu'un
  // transfert : il ne doit pas être requalifié en simple abandon.
  MESSAGE: 4,
  HANDOFF: 5,
  RESERVED: 6,
};

const MENU_TRANSCRIPT_RE = /menus?|carte des plats|plats? du jour|prix/i;
const INFO_TRANSCRIPT_RE = /horaire|ouvert|ferm[eé]|menus?|carte|prix/i;

const DEFAULT_STT_PROVIDER = 'elevenlabs-scribe-v2-realtime';

export function defaultTtsProvider(): string {
  return `cartesia-${CARTESIA_MODEL}`;
}

/**
 * Déduit le résultat à partir des faits, jamais de la seule intention.
 * Une réservation réellement créée gagne toujours ; un transfert accepté est
 * un aboutissement, un message enregistré est un traitement sans réservation.
 */
export function resolveVoiceOutcome(facts: VoiceCallFacts): CallOutcome {
  if (facts.reservationCreated) return 'RESERVED';
  if (facts.handoffAccepted) return 'HANDOFF';
  // Un message déjà enregistré est un aboutissement : une panne de transport
  // survenue après coup ne doit pas le requalifier en erreur.
  if (facts.messageRecorded) return 'MESSAGE';
  if (facts.errored) return 'ERROR';
  if (facts.informational) return 'INFO';
  return 'NO_ACTION';
}

/** Ne remplace jamais un transcript complet par un transcript plus court. */
export function pickTranscript(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const current = existing?.trim() ?? '';
  const next = incoming?.trim() ?? '';
  if (!next) return existing ?? null;
  if (next.length <= current.length) return existing ?? null;
  return next;
}

/** Une durée absente ou nulle ne doit pas effacer une durée déjà connue. */
export function pickDuration(
  existing: number | null | undefined,
  incoming: number | null | undefined,
): number | null {
  if (incoming === null || incoming === undefined || !Number.isFinite(incoming)) {
    return existing ?? null;
  }
  const rounded = Math.round(incoming);
  if (rounded > 0) return rounded;
  return existing ?? rounded;
}

/** Préfère la valeur observée dans le pipeline, puis le défaut configuré. */
export function pickProvider(
  incoming: string | null | undefined,
  observed: string | null | undefined,
  fallback: string,
): string {
  const provided = incoming?.trim();
  if (provided) return provided;
  const seen = observed?.trim();
  if (seen) return seen;
  return fallback;
}

/** Déduit l'intention appelant, distincte du succès de la réservation. */
export function deriveCallIntent(input: {
  conversationIntent?: string | null;
  transcript?: string | null;
  existing?: CallIntent | null;
}): CallIntent | null {
  const conversation = input.conversationIntent ?? null;
  if (conversation === 'reservation' || conversation === 'availability') return 'RESERVATION';
  if (conversation === 'cancel') return 'CANCEL';
  if (conversation === 'gift_card' || conversation === 'message' || conversation === 'delay') {
    return 'OTHER';
  }

  const transcript = input.transcript ?? '';
  if (transcript) {
    if (hadReservationIntent({ transcript })) return 'RESERVATION';
    if (MENU_TRANSCRIPT_RE.test(transcript)) return 'MENU';
    if (INFO_TRANSCRIPT_RE.test(transcript)) return 'HOURS';
  }

  // Une intention déjà connue n'est jamais effacée par un événement tardif
  // qui ne porte plus la transcription.
  return input.existing ?? null;
}

/** Un outcome plus faible ne remplace jamais un outcome plus fort. */
export function pickOutcome(
  existing: CallOutcome | null | undefined,
  candidate: CallOutcome,
): CallOutcome {
  if (!existing) return candidate;
  return OUTCOME_RANK[candidate] >= OUTCOME_RANK[existing] ? candidate : existing;
}

/** Une intention déjà identifiée reste prioritaire sauf upgrade explicite. */
export function pickIntent(
  existing: CallIntent | null | undefined,
  candidate: CallIntent | null,
): CallIntent | null {
  if (!candidate) return existing ?? null;
  if (!existing) return candidate;
  if (existing === candidate) return existing;
  return candidate === 'RESERVATION' ? candidate : existing;
}

export interface CallFinalizationSnapshot {
  id: string;
  restaurantId: string;
  callSid: string;
  callerPhone: string | null;
  durationSec: number | null;
  transcript: string | null;
  intent: CallIntent | null;
  outcome: CallOutcome | null;
  sttProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
  reservationCreated: boolean;
  messageRecorded: boolean;
}

export interface CallFinalizationPlan {
  facts: VoiceCallFacts;
  data: CallFinalizationData;
  updatedFields: string[];
  outcome: CallOutcome;
  intent: CallIntent | null;
}

/** Champs concrets écrits sur `Call`, valables en création comme en mise à jour. */
export interface CallFinalizationData {
  transcript?: string | null;
  intent?: CallIntent | null;
  outcome?: CallOutcome;
  durationSec?: number | null;
  sttProvider?: string;
  llmProvider?: string;
  ttsProvider?: string;
}

/**
 * Calcule la mise à jour finale sans toucher à la base : c'est le cœur
 * idempotent et ordonnable, testable sans Prisma.
 */
export function planCallFinalization(
  snapshot: CallFinalizationSnapshot,
  hints: VoiceFinalizationHints,
): CallFinalizationPlan {
  const transcript = pickTranscript(snapshot.transcript, hints.transcript);
  const intent = pickIntent(
    snapshot.intent,
    deriveCallIntent({
      conversationIntent: hints.conversationIntent,
      transcript: transcript ?? hints.transcript,
      existing: snapshot.intent,
    }),
  );
  const facts: VoiceCallFacts = {
    reservationCreated: snapshot.reservationCreated,
    handoffAccepted:
      snapshot.outcome === 'HANDOFF' || hints.handoffConclusion === 'manager_transfer_accepted',
    handoffFailed:
      hints.handoffConclusion === 'manager_transfer_failed' ||
      hints.handoffConclusion === 'manager_transfer_rejected',
    messageRecorded: snapshot.messageRecorded,
    reservationIntent: intent === 'RESERVATION',
    informational: false,
    errored: snapshot.outcome === 'ERROR' || hints.endedReason === 'error',
  };
  const effectiveTranscript = transcript ?? hints.transcript ?? '';
  facts.informational =
    !facts.reservationCreated &&
    !facts.handoffAccepted &&
    !facts.errored &&
    effectiveTranscript.length > 0 &&
    INFO_TRANSCRIPT_RE.test(effectiveTranscript);

  const outcome = pickOutcome(snapshot.outcome, resolveVoiceOutcome(facts));
  const durationSec = pickDuration(snapshot.durationSec, hints.durationSec);
  const sttProvider = pickProvider(hints.sttProvider, snapshot.sttProvider, DEFAULT_STT_PROVIDER);
  const llmProvider = pickProvider(hints.llmProvider, snapshot.llmProvider, getVoiceLlmProvider());
  const ttsProvider = pickProvider(hints.ttsProvider, snapshot.ttsProvider, defaultTtsProvider());

  const data: CallFinalizationData = {};
  const updatedFields: string[] = [];
  if (transcript !== snapshot.transcript) {
    data.transcript = transcript;
    updatedFields.push('transcript');
  }
  if (intent !== snapshot.intent) {
    data.intent = intent;
    updatedFields.push('intent');
  }
  if (outcome !== snapshot.outcome) {
    data.outcome = outcome;
    updatedFields.push('outcome');
  }
  if (durationSec !== snapshot.durationSec) {
    data.durationSec = durationSec;
    updatedFields.push('durationSec');
  }
  if (sttProvider !== snapshot.sttProvider) {
    data.sttProvider = sttProvider;
    updatedFields.push('sttProvider');
  }
  if (llmProvider !== snapshot.llmProvider) {
    data.llmProvider = llmProvider;
    updatedFields.push('llmProvider');
  }
  if (ttsProvider !== snapshot.ttsProvider) {
    data.ttsProvider = ttsProvider;
    updatedFields.push('ttsProvider');
  }

  return { facts, data, updatedFields, outcome, intent };
}

interface CallFinalizationRow {
  id: string;
  restaurantId: string;
  callSid: string;
  callerPhone?: string | null;
  durationSec: number | null;
  transcript: string | null;
  intent: CallIntent | null;
  outcome: CallOutcome | null;
  sttProvider: string | null;
  llmProvider: string | null;
  ttsProvider: string | null;
  reservation?: { id: string } | null;
  messages?: Array<{ id: string }>;
}

function toSnapshot(row: CallFinalizationRow): CallFinalizationSnapshot {
  return {
    id: row.id,
    restaurantId: row.restaurantId,
    callSid: row.callSid,
    callerPhone: row.callerPhone ?? null,
    // Un appel partiellement mocké ou lu avec un select réduit ne doit pas
    // produire de comparaison `undefined` qui déclencherait une écriture.
    durationSec: row.durationSec ?? null,
    transcript: row.transcript ?? null,
    intent: row.intent ?? null,
    outcome: row.outcome ?? null,
    sttProvider: row.sttProvider ?? null,
    llmProvider: row.llmProvider ?? null,
    ttsProvider: row.ttsProvider ?? null,
    reservationCreated: Boolean(row.reservation),
    messageRecorded: (row.messages?.length ?? 0) > 0,
  };
}

function emptyFacts(): VoiceCallFacts {
  return {
    reservationCreated: false,
    handoffAccepted: false,
    handoffFailed: false,
    messageRecorded: false,
    reservationIntent: false,
    informational: false,
    errored: false,
  };
}

async function lockCallRow(tx: Prisma.TransactionClient, callSid: string): Promise<void> {
  const queryRaw = (tx as unknown as { $queryRaw?: (query: unknown) => Promise<unknown> })
    .$queryRaw;
  if (typeof queryRaw !== 'function') return;
  await queryRaw.call(
    tx,
    Prisma.sql`SELECT id FROM "calls" WHERE call_sid = ${callSid} FOR UPDATE`,
  );
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

const CALL_FINALIZATION_SELECT = {
  id: true,
  restaurantId: true,
  callSid: true,
  callerPhone: true,
  durationSec: true,
  transcript: true,
  intent: true,
  outcome: true,
  sttProvider: true,
  llmProvider: true,
  ttsProvider: true,
  reservation: { select: { id: true } },
  messages: { select: { id: true }, take: 1 },
} as const;

export interface CallRecoveryDispatchInput {
  callId: string;
  restaurantId: string;
  customerPhone: string;
  customerName: string | null;
  restaurantName: string;
  restaurantSlug: string | null;
  restaurantPhone: string | null;
  reason: 'no_action_with_intent' | 'handoff_dropped' | 'transport_error';
}

export interface CallFinalizationDependencies {
  db: typeof db;
  /** Résolution du contexte restaurant à partir du numéro Telnyx `to`. */
  loadRestaurantContext?: (
    to: string,
  ) => Promise<{ id: string; name: string; slug: string | null; phoneNumber: string | null }>;
  /** Enqueue de la récupération commerciale (idempotent par `jobId`). */
  enqueueRecovery?: (input: CallRecoveryDispatchInput, callLegId: string) => Promise<void>;
}

/**
 * Finalise un appel : calcule le résultat à partir des faits, écrit une mise à
 * jour monotone, puis déclenche la récupération commerciale si elle est due.
 *
 * Ne lève jamais pour un appel inconnu sans restaurant : retourne un résultat
 * avec `skippedReason`, l'appelant décide (400 sur la route, log ailleurs).
 */
export async function finalizeVoiceCall(
  callSid: string,
  hints: VoiceFinalizationHints,
  dependencies: CallFinalizationDependencies = { db },
): Promise<VoiceFinalizationResult> {
  return finalizeVoiceCallAttempt(callSid, hints, dependencies, 0);
}

function applyPlanToSnapshot(
  snapshot: CallFinalizationSnapshot,
  plan: CallFinalizationPlan,
): CallFinalizationSnapshot {
  return {
    ...snapshot,
    transcript: plan.data.transcript !== undefined ? plan.data.transcript : snapshot.transcript,
    intent: plan.data.intent !== undefined ? plan.data.intent : snapshot.intent,
    outcome: plan.data.outcome ?? snapshot.outcome,
    durationSec: plan.data.durationSec !== undefined ? plan.data.durationSec : snapshot.durationSec,
    sttProvider: plan.data.sttProvider ?? snapshot.sttProvider,
    llmProvider: plan.data.llmProvider ?? snapshot.llmProvider,
    ttsProvider: plan.data.ttsProvider ?? snapshot.ttsProvider,
  };
}

async function finalizeVoiceCallAttempt(
  callSid: string,
  hints: VoiceFinalizationHints,
  dependencies: CallFinalizationDependencies,
  attempt: number,
): Promise<VoiceFinalizationResult> {
  const { db: client } = dependencies;

  let snapshot: CallFinalizationSnapshot;
  let plan: CallFinalizationPlan;
  let created = false;

  try {
    const executed = await client.$transaction(async (tx) => {
      await lockCallRow(tx, callSid);
      // tenant-scoping: global — le callSid Telnyx est unique et identifie
      // l'appel avant que le restaurant ne soit connu.
      const existing = (await tx.call.findUnique({
        where: { callSid },
        select: CALL_FINALIZATION_SELECT,
      })) as CallFinalizationRow | null;

      if (!existing) {
        if (!hints.restaurantId) return { missingRestaurant: true as const };
        const createPlan = planCallFinalization(
          {
            id: '',
            restaurantId: hints.restaurantId,
            callSid,
            callerPhone: hints.customerPhone ?? null,
            durationSec: null,
            transcript: null,
            intent: null,
            outcome: null,
            sttProvider: null,
            llmProvider: null,
            ttsProvider: null,
            reservationCreated: false,
            messageRecorded: false,
          },
          hints,
        );
        const createdRow = (await tx.call.create({
          data: {
            callSid,
            restaurantId: hints.restaurantId,
            carrier: 'telnyx',
            callerPhone: hints.customerPhone ?? null,
            transcript: createPlan.data.transcript ?? null,
            intent: createPlan.intent,
            outcome: createPlan.outcome,
            durationSec: createPlan.data.durationSec ?? null,
            sttProvider: String(createPlan.data.sttProvider),
            llmProvider: String(createPlan.data.llmProvider),
            ttsProvider: String(createPlan.data.ttsProvider),
          },
          select: CALL_FINALIZATION_SELECT,
        })) as { id?: string } | undefined;
        return {
          created: true as const,
          snapshot: {
            id: typeof createdRow?.id === 'string' ? createdRow.id : '',
            restaurantId: hints.restaurantId,
            callSid,
            callerPhone: hints.customerPhone ?? null,
            durationSec: createPlan.data.durationSec ?? null,
            transcript: createPlan.data.transcript ?? null,
            intent: createPlan.intent,
            outcome: createPlan.outcome,
            sttProvider: String(createPlan.data.sttProvider),
            llmProvider: String(createPlan.data.llmProvider),
            ttsProvider: String(createPlan.data.ttsProvider),
            reservationCreated: false,
            messageRecorded: false,
          } satisfies CallFinalizationSnapshot,
          plan: createPlan,
        };
      }

      const existingSnapshot = toSnapshot(existing);
      const existingPlan = planCallFinalization(existingSnapshot, hints);
      if (existingPlan.updatedFields.length === 0) {
        return { created: false as const, snapshot: existingSnapshot, plan: existingPlan };
      }
      // tenant-scoping: global — mise à jour de l'appel identifié par son
      // callSid unique ; le restaurant est déjà porté par la ligne.
      await tx.call.update({
        where: { callSid },
        data: existingPlan.data,
      });
      return {
        created: false as const,
        snapshot: applyPlanToSnapshot(existingSnapshot, existingPlan),
        plan: existingPlan,
      };
    }, DEFAULT_TRANSACTION_OPTIONS);

    if ('missingRestaurant' in executed) {
      return {
        callSid,
        callId: null,
        created: false,
        updatedFields: [],
        outcome: null,
        intent: null,
        facts: emptyFacts(),
        skippedReason: 'unknown_restaurant',
      };
    }

    created = executed.created;
    snapshot = executed.snapshot;
    plan = executed.plan;
  } catch (err) {
    if (isUniqueViolation(err) && attempt < 2) {
      // Course entre deux finalisations concurrentes : la seconde relit la
      // ligne créée par la première et applique sa mise à jour monotone.
      return finalizeVoiceCallAttempt(callSid, hints, dependencies, attempt + 1);
    }
    throw err;
  }

  const updatedFields = [...plan.updatedFields];
  const recoveryDispatched = await dispatchRecoveryIfEligible(snapshot, plan, hints, dependencies);
  if (recoveryDispatched) updatedFields.push('recovery');

  // Le flux peut avoir persisté les tours avant que la réservation/outcome ne
  // soit finalisé. Réconcilier le bilan ici rend les KPIs monotones même quand
  // les webhooks arrivent dans l'ordre inverse. La table est additive : les
  // anciens appels sans télémétrie ne provoquent aucune écriture fantôme.
  const voiceCallTelemetry = (
    client as unknown as {
      voiceCallTelemetry?: {
        updateMany: (args: {
          where: { callId: string };
          data: Record<string, unknown>;
        }) => Promise<unknown>;
      };
    }
  ).voiceCallTelemetry;
  if (voiceCallTelemetry && snapshot.id) {
    try {
      const reservationConfirmed = plan.facts.reservationCreated;
      const reservationIntentAbandoned =
        plan.facts.reservationIntent &&
        !plan.facts.reservationCreated &&
        !plan.facts.handoffAccepted &&
        !plan.facts.messageRecorded;
      await voiceCallTelemetry.updateMany({
        where: { callId: snapshot.id },
        data: {
          ...(reservationConfirmed ? { reservationConfirmed: true } : {}),
          reservationIntentAbandoned,
          finalizedAt: new Date(),
        },
      });
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), callSid },
        '[call-finalization] voice telemetry reconciliation failed',
      );
    }
  }

  logger.info(
    {
      callSid,
      source: hints.source,
      created,
      updatedFields,
      outcome: plan.outcome,
      intent: plan.intent,
      facts: plan.facts,
    },
    '[call-finalization] call finalized',
  );

  return {
    callSid,
    callId: snapshot.id || null,
    created,
    updatedFields,
    outcome: plan.outcome,
    intent: plan.intent,
    facts: plan.facts,
  };
}

/**
 * Récupération commerciale : uniquement si aucune réservation n'a été créée,
 * et seulement si l'appel n'a pas déjà été pris en charge par un humain
 * (transfert accepté ou message enregistré). Les règles d'éligibilité
 * historiques sur l'outcome et l'intention sont conservées. L'idempotence est
 * portée par le `jobId` BullMQ et par le claim du worker, donc un rejeu ne
 * renvoie rien.
 */
async function dispatchRecoveryIfEligible(
  snapshot: CallFinalizationSnapshot,
  plan: CallFinalizationPlan,
  hints: VoiceFinalizationHints,
  dependencies: CallFinalizationDependencies,
): Promise<boolean> {
  if (!dependencies.enqueueRecovery) return false;
  // Sans identifiant de ligne, la récupération ne serait pas idempotente.
  if (!snapshot.id) return false;
  if (plan.facts.reservationCreated) return false;
  if (plan.facts.handoffAccepted) return false;
  if (plan.facts.messageRecorded) return false;
  if (plan.outcome === 'RESERVED' || plan.outcome === 'INFO' || plan.outcome === 'MESSAGE') {
    return false;
  }
  if (!plan.facts.reservationIntent) return false;
  // Le numéro vient de l'événement courant, ou de la ligne persistée quand le
  // rattrapage rejoue un appel dont le webhook ne portait plus le numéro.
  const customerPhone = (hints.customerPhone ?? snapshot.callerPhone)?.trim();
  if (!customerPhone) return false;

  let restaurant: { name: string; slug: string | null; phoneNumber: string | null } | null = null;
  if (dependencies.loadRestaurantContext && hints.to) {
    try {
      restaurant = await dependencies.loadRestaurantContext(hints.to);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), callSid: snapshot.callSid },
        '[call-finalization] restaurant context lookup failed',
      );
    }
  }

  try {
    await dependencies.enqueueRecovery(
      {
        callId: snapshot.id,
        restaurantId: snapshot.restaurantId,
        customerPhone,
        customerName: hints.customerName ?? null,
        restaurantName: restaurant?.name ?? '',
        restaurantSlug: restaurant?.slug ?? null,
        restaurantPhone: restaurant?.phoneNumber ?? null,
        reason: plan.facts.handoffFailed
          ? 'handoff_dropped'
          : plan.outcome === 'ERROR'
            ? 'transport_error'
            : 'no_action_with_intent',
      },
      snapshot.callSid,
    );
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), callSid: snapshot.callSid },
      '[call-finalization] failed to enqueue recovery SMS',
    );
    captureException(err, {
      tags: { service: 'call-finalization', action: 'enqueue-recovery' },
      extra: { callSid: snapshot.callSid },
    });
    return false;
  }
}
