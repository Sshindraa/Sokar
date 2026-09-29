/**
 * Moteur de tour structuré (canary). Un appel au modèle comprend le tour,
 * tient le brouillon, choisit une action et formule la réponse. Le code valide
 * les faits proposés, exécute les actions autorisées et rend leur résultat au
 * modèle pour la formulation. Aucune règle lexicale n'interprète l'appelant.
 */
import type { CallSession, DebugSpeechEntry } from '../types';
import { observeSemanticSignalsShadow } from '../turn-plan-shadow';
import type { CallSessionManager } from '../manager';
import { cleanTextForTts, isSessionActiveForTts, speakTtsStreamed } from '../tts-handler';
import { createCartesiaContextTurn, isCartesiaContextV2Enabled } from '../cartesia-context';
import { effectiveVoiceLanguage } from '../voice-language';
import { finishCall } from '../call-ending';
import { parseRestaurantIdList } from '../feature-flags';
import {
  markVoiceTurnLlmFirstPhrase,
  markVoiceTurnLlmFirstToken,
  recordVoiceTurnEvent,
  recordVoiceTurnEventIfCurrent,
} from '../turn-telemetry';
import {
  buildLlmFailurePlan,
  getReservationConfirmationKey,
  voiceMaxPartySize,
} from '../conversation-controller';
import {
  appendDebugSpeechText,
  recordDebugAgentSpeech,
  recordDebugTool,
  settleDebugSpeech,
} from '../debug-dialogue';
import { logger } from '../../../../shared/logger/pino';
import {
  STRUCTURED_TURN_SCHEMA_NAME,
  buildStructuredTurnJsonSchema,
  parseStructuredTurnOutput,
  type StructuredTurnAction,
  type StructuredTurnOutput,
} from './schema';
import {
  applyProposedDraft,
  authorizeStructuredAction,
  bookingKey,
  createStructuredTurnState,
  isBookingComplete,
  dayPartInTimezone,
  todayInTimezone,
  type StructuredTurnState,
} from './fact-guards';
import { buildStructuredTurnMessages } from './prompt';
import {
  cancelSpeculation,
  isStructuredSpeculationEnabled,
  startSpeculation,
  takeSpeculation,
} from './speculation';
import { PhraseSplitter, SayStreamExtractor } from './say-stream';

export function isStructuredTurnEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    restaurantId &&
    parseRestaurantIdList(env.VOICE_STRUCTURED_TURN_RESTAURANT_IDS).includes(restaurantId),
  );
}

function responseFormat(
  actions?: readonly StructuredTurnAction[],
  options: { turnCompleteOnly?: boolean } = {},
) {
  return {
    type: 'json_schema' as const,
    json_schema: {
      name: STRUCTURED_TURN_SCHEMA_NAME,
      strict: true as const,
      schema: buildStructuredTurnJsonSchema(actions, options),
    },
  };
}

/** Après une action exécutée, le modèle ne peut plus que parler ou terminer l'appel. */
const AFTER_ACTION_ACTIONS: readonly StructuredTurnAction[] = ['none', 'end_call'];

/** Au-delà, seuls les créneaux les plus proches de l'heure demandée sont donnés au modèle. */
const MAX_SLOTS_IN_RESULT = 12;

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/** « dimanche 27 septembre » pour une date AAAA-MM-JJ. */
function spokenDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  if (!year || !month || !day) return 'ce jour-là';
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function nearestSlots(slots: string[], time: string): string[] {
  if (slots.length <= MAX_SLOTS_IN_RESULT || !time) return slots.slice(0, MAX_SLOTS_IN_RESULT);
  const target = minutesOf(time);
  return [...slots]
    .sort((left, right) => Math.abs(minutesOf(left) - target) - Math.abs(minutesOf(right) - target))
    .slice(0, MAX_SLOTS_IN_RESULT)
    .sort();
}

const PENDING_BY_AWAITING: Partial<
  Record<StructuredTurnOutput['awaiting'], CallSession['conversation']['pendingQuestion']>
> = {
  date: 'date',
  time: 'time',
  partySize: 'partySize',
  customerName: 'customerName',
  // Relecture de l'orthographe : l'appelant peut ré-épeler, le profil STT d'épellation reste actif.
  customerNameConfirmation: 'customerName',
  confirmation: 'confirmation',
  humanFallback: 'humanFallback',
};

/** Miroir du brouillon dans l'état historique : télémétrie, finalisation, profil STT. */
function mirrorConversation(session: CallSession, state: StructuredTurnState): void {
  const { conversation } = session;
  const { draft } = state;
  if (draft.date || draft.time || draft.partySize || draft.customerName) {
    conversation.intent = conversation.intent ?? 'reservation';
  }
  conversation.slots.date = draft.date || undefined;
  conversation.slots.time = draft.time || undefined;
  conversation.slots.partySize = draft.partySize || undefined;
  conversation.slots.customerName = draft.customerName.trim() || undefined;
  conversation.pendingQuestion = PENDING_BY_AWAITING[state.lastAwaiting] ?? null;
}

interface PassResult {
  output: StructuredTurnOutput;
  spoken: boolean;
}

/**
 * Silence après un tour jugé inachevé avant de répondre quand même : l'appelant
 * cherchait peut-être ses mots mais attend maintenant une réponse.
 */
export const INCOMPLETE_TURN_SILENCE_MS = 2_500;

/** Dite si la relance après un silence ne produit toujours aucune phrase. */
export const CALLER_FINISHED_FALLBACK = 'Oui, je vous écoute ?';

const incompleteTurnTimers = new WeakMap<CallSession, ReturnType<typeof setTimeout>>();

function clearIncompleteTurnTimer(session: CallSession): void {
  const timer = incompleteTurnTimers.get(session);
  if (timer) clearTimeout(timer);
  incompleteTurnTimers.delete(session);
}

function armIncompleteTurnTimer(
  session: CallSession,
  mgr: CallSessionManager,
  fragment: string,
): void {
  clearIncompleteTurnTimer(session);
  const timer = setTimeout(() => {
    incompleteTurnTimers.delete(session);
    if (session.ended || session.ending) return;
    if (session.structuredTurn?.pendingFragment !== fragment) return;
    const generation = ++session.responseGeneration;
    runStructuredTurn(
      session,
      '',
      mgr,
      () => !session.ended && session.responseGeneration === generation,
      { callerFinished: true },
    ).catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[structured-turn] Silent-caller turn failed',
      );
    });
  }, INCOMPLETE_TURN_SILENCE_MS);
  timer.unref?.();
  incompleteTurnTimers.set(session, timer);
}

/** Attente maximale d'une lecture de créneaux en cours au début d'un tour. */
export const DAY_PREFETCH_WAIT_MS = 150;
/** Borne du nombre de requêtes de créneaux par jour lu. */
const MAX_PREFETCH_PARTY_SIZE = 12;

const dayPrefetches = new WeakMap<CallSession, { date: string; promise: Promise<void> }>();

/**
 * Lit en tâche de fond les créneaux réels du jour pour chaque taille de groupe
 * (quelques millisecondes par taille). Le modèle les reçoit dans l'ÉTAT
 * VÉRIFIÉ et peut annoncer la disponibilité sans second appel. Une lecture
 * déjà en cours pour ce jour est réutilisée.
 */
function prefetchDayAvailability(
  session: CallSession,
  mgr: CallSessionManager,
  state: StructuredTurnState,
  date: string,
): Promise<void> {
  const inFlight = dayPrefetches.get(session);
  if (inFlight?.date === date) return inFlight.promise;
  const maxSize = Math.min(voiceMaxPartySize(session), MAX_PREFETCH_PARTY_SIZE);
  const sizes = Array.from({ length: maxSize }, (_, index) => index + 1);
  const promise = Promise.all(sizes.map((size) => mgr.getAvailability(session, date, size)))
    .then((results) => {
      if (state.draft.date !== date) return;
      // Jour fermé : pas de raccourci, la vérification garde sa phrase fixe
      // « Nous sommes fermés… » (sinon le modèle répondait « c'est noté »).
      if (results.every((result) => result.slots.length === 0 && result.allSlots.length === 0)) {
        state.dayAvailability = null;
        return;
      }
      state.dayAvailability = {
        date,
        closed: results.every(
          (result) => result.slots.length === 0 && result.allSlots.length === 0,
        ),
        slotsBySize: Object.fromEntries(
          results.map((result, index) => [sizes[index], result.slots]),
        ),
      };
    })
    .catch((err: unknown) => {
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[structured-turn] Day availability prefetch failed',
      );
    })
    .finally(() => {
      if (dayPrefetches.get(session)?.promise === promise) dayPrefetches.delete(session);
    });
  dayPrefetches.set(session, { date, promise });
  return promise;
}

async function waitAtMost(promise: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([promise, new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  if (timer) clearTimeout(timer);
}

/** Créneaux du jour lus d'avance pour le brouillon, s'ils le couvrent. */
function prefetchedSlots(state: StructuredTurnState): string[] | null {
  const { draft, dayAvailability } = state;
  if (!dayAvailability || dayAvailability.date !== draft.date || draft.partySize < 1) return null;
  const slots = dayAvailability.slotsBySize[draft.partySize];
  // Aucun créneau pour ce nombre : même règle, la vérification annonce « complet ».
  return slots?.length ? slots : null;
}

/** Requête d'un passage : partagée par le tour et par la spéculation. */
function passRequest(
  session: CallSession,
  state: StructuredTurnState,
  transcript: string,
  history: CallSession['history'],
  today: string,
  extra: { actionResult?: string; callerFinished?: boolean } = {},
) {
  const messages = buildStructuredTurnMessages({
    systemPrompt: session.systemPrompt,
    history,
    transcript,
    state,
    openingHours: session.openingHours,
    today,
    dayPart: dayPartInTimezone(session.timezone || 'Europe/Paris'),
    ...extra,
  });
  // Relance après un silence (appel cdc95509) : le modèle répondait encore
  // turnComplete=false et une phrase vide ; le schéma impose maintenant true.
  const format = responseFormat(extra.actionResult ? AFTER_ACTION_ACTIONS : undefined, {
    turnCompleteOnly: extra.callerFinished === true,
  });
  return { messages, format };
}

/**
 * Partielle Deepgram stable pendant que l'agent écoute : lance en avance le
 * premier passage, sans rien dire ni exécuter (voir speculation.ts).
 */
export function speculateStructuredTurn(
  session: CallSession,
  mgr: CallSessionManager,
  partialTranscript: string,
): void {
  if (!isStructuredSpeculationEnabled() || !isStructuredTurnEnabled(session.restaurantId)) return;
  if (session.ended || session.ending || session.state !== 'LISTENING') return;
  const state = session.structuredTurn ?? createStructuredTurnState();
  const transcript = [state.pendingFragment, partialTranscript]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .trim();
  if (!transcript) return;
  const today = todayInTimezone(session.timezone || 'Europe/Paris');
  const { messages, format } = passRequest(session, state, transcript, [...session.history], today);
  startSpeculation(session, mgr, messages, format);
}

export async function runStructuredTurn(
  session: CallSession,
  rawTranscript: string,
  mgr: CallSessionManager,
  isCurrentResponse: () => boolean,
  options: { callerFinished?: boolean } = {},
): Promise<void> {
  const state = (session.structuredTurn ??= createStructuredTurnState());
  clearIncompleteTurnTimer(session);
  // Un début de phrase retenu au tour précédent est la même prise de parole.
  const transcript = [state.pendingFragment, rawTranscript]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .trim();
  state.pendingFragment = null;
  if (!transcript) return;
  const turnId = session.currentTurn?.id;
  const abortController = new AbortController();
  session.abortController = abortController;
  const isLive = () => isCurrentResponse() && !abortController.signal.aborted;
  const today = todayInTimezone(session.timezone || 'Europe/Paris');
  if (state.draft.date) {
    // Normalement déjà lue à la fin du tour précédent : l'attente est bornée.
    const needed =
      dayPrefetches.get(session)?.date === state.draft.date ||
      state.dayAvailability?.date !== state.draft.date;
    if (needed) {
      await waitAtMost(
        prefetchDayAvailability(session, mgr, state, state.draft.date),
        DAY_PREFETCH_WAIT_MS,
      );
    }
  }
  if (state.dayAvailability && state.dayAvailability.date !== state.draft.date) {
    state.dayAvailability = null;
  }
  const historyBefore = [...session.history];
  const ttsPromises: Promise<void>[] = [];
  // Toutes les phrases d'une réponse partent dans un même contexte Cartesia :
  // intonation continue et plus de blanc entre deux phrases (appels 0d49230d,
  // 88921164 : 1,2 à 1,6 s de silence entre « Avec plaisir ! » et la suite, la
  // phrase suivante n'étant synthétisée qu'après la fin de la précédente).
  // Le socket s'ouvre pendant la génération ; repli HTTP sans audio envoyé.
  const contextTts = isCartesiaContextV2Enabled() ? createCartesiaContextTurn(session, true) : null;
  if (contextTts) session.ttsContext = contextTts;
  const spokenPhrases: string[] = [];
  let contextDebugEntry: DebugSpeechEntry | null = null;
  const flushSpeech = async () => {
    if (contextTts && spokenPhrases.length) {
      try {
        await contextTts.finish();
        settleDebugSpeech(contextDebugEntry, contextTts.framesSent, true);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), callId: session.callControlId },
          '[structured-turn] Cartesia context failed',
        );
        if (!contextTts.hasAudioOutput && isSessionActiveForTts(session)) {
          await speakTtsStreamed(session, spokenPhrases.join(' ')).catch(() => undefined);
        }
      }
    }
    await Promise.all(ttsPromises);
  };
  const startedAt = Date.now();
  let firstPhraseSpoken = false;

  session.turnCount++;
  session.history.push({ role: 'user', content: transcript });
  mgr.transition(session, 'PROCESSING');
  recordVoiceTurnEvent(session, 'llm_started', { mode: 'structured' });

  const speakPhrase = (phrase: string) => {
    if (!isLive()) return;
    if (!firstPhraseSpoken) {
      firstPhraseSpoken = true;
      markVoiceTurnLlmFirstPhrase(session, turnId);
      mgr.transition(session, 'SPEAKING');
    }
    recordVoiceTurnEvent(session, 'llm_phrase_generated', { characterCount: phrase.length });
    // La voix surjoue les points d'exclamation sur une phrase courte (« Avec
    // plaisiiir ! », appel 0d49230d) : ton posé côté synthèse.
    phrase = phrase.replace(/\s*!/g, '.');
    spokenPhrases.push(phrase);
    if (contextTts) {
      // Une réplique du relevé par réponse, mesurée par les trames du contexte
      // (appel 25650799 : relevé vide côté agent sans cela).
      if (contextDebugEntry) appendDebugSpeechText(contextDebugEntry, phrase);
      else contextDebugEntry = recordDebugAgentSpeech(session, phrase);
      contextTts.push(cleanTextForTts(phrase, effectiveVoiceLanguage(session)));
      return;
    }
    ttsPromises.push(speakTtsStreamed(session, phrase).catch(() => undefined));
  };

  const runPass = async (actionResult?: string): Promise<PassResult> => {
    const extractor = new SayStreamExtractor();
    const splitter = new PhraseSplitter();
    let action: string | null = null;
    let turnComplete: boolean | null = null;
    let firstToken = true;
    const { messages, format } = passRequest(session, state, transcript, historyBefore, today, {
      ...(actionResult ? { actionResult } : {}),
      ...(options.callerFinished ? { callerFinished: true } : {}),
    });
    const onDelta = (delta: string) => {
      if (!isLive()) return;
      if (firstToken) {
        firstToken = false;
        markVoiceTurnLlmFirstToken(session, turnId);
      }
      const said = extractor.push(delta);
      // `turnComplete` et `action` précèdent `say` dans le schéma : ils sont
      // connus quand la phrase commence.
      if (turnComplete === null) {
        const match = /"turnComplete"\s*:\s*(true|false)/.exec(extractor.raw);
        if (match) turnComplete = match[1] === 'true';
      }
      action ??= /"action"\s*:\s*"([a-z_]+)"/.exec(extractor.raw)?.[1] ?? null;
      const mayContinue = turnComplete === true || options.callerFinished === true;
      if (said && action === 'none' && mayContinue) splitter.push(said).forEach(speakPhrase);
    };
    // Premier passage : reprendre la requête déjà lancée sur la partielle stable
    // si elle est identique ; sinon (ou en cas d'échec) appel normal.
    let text: string | null = null;
    const speculative =
      !actionResult && !options.callerFinished
        ? takeSpeculation(session, messages, format, onDelta, abortController.signal)
        : null;
    if (speculative) {
      speculationUsed = true;
      text = await speculative.catch(() => null);
    }
    text ??= await mgr.streamStructuredCompletion(session, messages, format, {
      signal: abortController.signal,
      telemetryTurnId: turnId,
      onDelta,
    });
    const output = parseStructuredTurnOutput(text);
    if (!output) throw new Error('Invalid structured turn output');
    const spoken = output.action === 'none' && (output.turnComplete || !!options.callerFinished);
    if (spoken) {
      const rest = splitter.flush();
      if (rest) speakPhrase(rest);
    }
    return { output, spoken };
  };

  let speculationUsed = false;
  // Phrase dite si le second passage ne formule rien après l'action.
  let actionFallbackSay: string | null = null;
  // Jour fermé ou complet : un fait simple, dit tel quel sans second passage
  // (appel 0d49230d : le modèle contredisait « FERMÉ » et promettait de réserver).
  const fixed: { reply: { say: string; awaiting: StructuredTurnOutput['awaiting'] } | null } = {
    reply: null,
  };

  const runAvailability = async (): Promise<string> => {
    const { date, time, partySize } = state.draft;
    recordDebugTool(session, 'checkAvailability');
    recordVoiceTurnEvent(session, 'availability_started', {});
    const availabilityStartedAt = Date.now();
    try {
      const result = await mgr.getAvailability(session, date, partySize);
      state.availability = { date, partySize, slots: result.slots };
      recordVoiceTurnEvent(session, 'availability_completed', {
        durationMs: Date.now() - availabilityStartedAt,
        slotCount: result.slots.length,
      });
      const offered = nearestSlots(result.slots, time);
      const requested = time
        ? result.slots.includes(time)
          ? ` ${time} est disponible.`
          : ` ${time} n'est pas disponible.`
        : '';
      if (result.slots.length) {
        return `Disponibilité réelle le ${date} pour ${partySize} personne(s) : créneaux libres ${offered.join(', ')}.${requested} Ne propose que ces horaires.`;
      }
      const day = spokenDay(date);
      if (result.allSlots.length === 0) {
        // Aucun créneau généré : le restaurant n'ouvre pas ce jour-là.
        fixed.reply = {
          say: `Nous sommes fermés ${day}. Voulez-vous venir un autre jour ?`,
          awaiting: 'date',
        };
        return `Le restaurant est FERMÉ le ${date} (${day}) : aucun service ce jour-là. Dis-le clairement et propose un autre jour d'ouverture.`;
      }
      fixed.reply = {
        say: `Je n'ai plus de table ${day} pour ${partySize} personnes. Voulez-vous essayer un autre jour, ou que je prenne un message ?`,
        awaiting: 'open',
      };
      return `Complet le ${date} pour ${partySize} personne(s) : aucun créneau libre. Propose une autre date, le gérant ou un message.`;
    } catch (err) {
      recordVoiceTurnEvent(session, 'availability_failed', {
        durationMs: Date.now() - availabilityStartedAt,
      });
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[structured-turn] Availability check failed',
      );
      actionFallbackSay =
        "Je n'arrive pas à vérifier les disponibilités pour le moment. Voulez-vous que je prenne un message pour le gérant ?";
      return "La vérification de disponibilité a échoué. N'annonce aucun horaire ; propose le gérant ou un message.";
    }
  };

  const runCreateReservation = async (): Promise<string> => {
    const { date, time, partySize, customerName } = state.draft;
    const { conversation } = session;
    conversation.slots.date = date;
    conversation.slots.time = time;
    conversation.slots.partySize = partySize;
    conversation.slots.customerName = customerName.trim();
    conversation.lastAvailabilityResult = {
      key: `${date}:${time}:${partySize}`,
      date,
      time,
      partySize,
      slots: state.availability?.slots ?? [],
    };
    // L'accord a été vérifié par les garde-fous : récapitulatif lu, accepté.
    conversation.confirmedReservationKey = getReservationConfirmationKey(session);
    const createdBefore = session.reservationCreatedAt;
    const result = await mgr.createReservationFromConversation(session);
    if (session.reservationCreatedAt !== createdBefore) state.reservationCreated = true;
    return (
      result ??
      "La réservation n'a pas pu être créée : les informations ne correspondent plus au créneau vérifié."
    );
  };

  const endCall = async (goodbye: string) => {
    await flushSpeech();
    session.history.push({ role: 'assistant', content: goodbye });
    await finishCall(session, mgr, goodbye);
  };

  try {
    const first = await runPass();
    // Une spéculation non reprise (requête différente, relance) ne sert plus.
    cancelSpeculation(session);
    if (!isLive()) return;
    if (!first.output.turnComplete && !options.callerFinished) {
      // L'appelant n'a pas fini : l'agent se tait et garde le début de phrase.
      session.history.pop();
      session.turnCount--;
      state.pendingFragment = transcript;
      recordVoiceTurnEvent(session, 'structured_turn', {
        pass: 1,
        turnComplete: false,
        interpretation: first.output.interpretation,
        confidence: first.output.confidence,
      });
      mgr.transition(session, 'LISTENING');
      armIncompleteTurnTimer(session, mgr, transcript);
      return;
    }
    const applied = applyProposedDraft(state.draft, first.output, { today });
    state.draft = applied.draft;
    // Créneaux lus d'avance et couvrant le brouillon : ce sont des faits vérifiés,
    // la réservation reste soumise aux mêmes garde-fous.
    const prefetched = prefetchedSlots(state);
    if (prefetched) {
      state.availability = {
        date: state.draft.date,
        partySize: state.draft.partySize,
        slots: prefetched,
      };
    }
    const decision = authorizeStructuredAction(state, first.output, state.draft, {
      maxPartySize: voiceMaxPartySize(session),
    });
    recordVoiceTurnEvent(session, 'structured_turn', {
      pass: 1,
      interpretation: first.output.interpretation,
      action: first.output.action,
      awaiting: first.output.awaiting,
      confidence: first.output.confidence,
      changedFields: applied.changed.join(',') || null,
      rejectedFields: applied.rejected.join(',') || null,
      actionDecision: decision.allowed ? 'allowed' : decision.reason,
      prefetchedDay: Boolean(state.dayAvailability),
      speculated: speculationUsed,
    });

    let final = first.output;
    let actionResult: string | null = null;
    if (!decision.allowed) {
      actionResult = `Action ${first.output.action} non exécutée (${decision.reason}). Poursuis la conversation sans l'annoncer comme faite.`;
    } else {
      switch (first.output.action) {
        case 'end_call':
          if (first.output.say.trim()) {
            await endCall(first.output.say.trim());
            return;
          }
          actionResult =
            "L'appelant termine l'appel : formule un au revoir court, action=end_call.";
          break;
        case 'check_availability':
          actionResult = await runAvailability();
          break;
        case 'create_reservation':
          actionResult = await runCreateReservation();
          break;
        case 'take_message':
          actionResult = first.output.message.trim()
            ? await mgr.recordCallerMessage(session, first.output.message.trim())
            : "Message vide, non enregistré : demande ce qu'il faut transmettre.";
          break;
        case 'transfer': {
          const reply = await mgr.handoffToManager(session, {
            kind: 'human_fallback_choice',
            choice: 'transfer',
          });
          if (!isLive()) return;
          session.history.push({ role: 'assistant', content: reply });
          speakPhrase(reply);
          await flushSpeech();
          return;
        }
        case 'none':
          break;
      }
    }

    const fixedReply = fixed.reply;
    if (fixedReply) {
      speakPhrase(fixedReply.say);
      final = {
        ...first.output,
        action: 'none',
        say: fixedReply.say,
        awaiting: fixedReply.awaiting,
      };
      actionResult = null;
    }

    if (actionResult) {
      if (!isLive()) return;
      const second = await runPass(actionResult);
      if (!isLive()) return;
      const reapplied = applyProposedDraft(state.draft, second.output, { today });
      state.draft = reapplied.draft;
      recordVoiceTurnEvent(session, 'structured_turn', {
        pass: 2,
        interpretation: second.output.interpretation,
        action: second.output.action,
        awaiting: second.output.awaiting,
        confidence: second.output.confidence,
        changedFields: reapplied.changed.join(',') || null,
        rejectedFields: reapplied.rejected.join(',') || null,
      });
      final = second.output;
      if (second.output.action === 'end_call' && second.output.confidence !== 'low') {
        if (second.output.say.trim()) {
          await endCall(second.output.say.trim());
          return;
        }
      } else if (!second.spoken && second.output.say.trim()) {
        // Une seconde action n'est jamais exécutée : la phrase reste dite.
        speakPhrase(second.output.say.trim());
      } else if (!second.output.say.trim() && actionFallbackSay) {
        // Phrase vide après l'action : dire le résultat plutôt que « je n'ai pas compris ».
        speakPhrase(actionFallbackSay);
        final = { ...second.output, say: actionFallbackSay, awaiting: 'open' };
      }
    }

    if (!final.say.trim() && options.callerFinished && final.action === 'none') {
      // Dernier filet de la relance : une invitation à continuer, jamais « pas compris ».
      final = { ...final, say: CALLER_FINISHED_FALLBACK, awaiting: 'open' };
      speakPhrase(CALLER_FINISHED_FALLBACK);
    }
    const said = final.say.trim();
    if (!said) throw new Error('Structured turn produced no speech');
    state.lastAwaiting = final.awaiting;
    state.recapKey =
      final.awaiting === 'confirmation' && isBookingComplete(state.draft)
        ? bookingKey(state.draft)
        : null;
    mirrorConversation(session, state);
    // Lecture fraîche du jour pour le tour suivant, sans attendre.
    if (state.draft.date) {
      // Les erreurs sont journalisées dans la lecture elle-même.
      prefetchDayAvailability(session, mgr, state, state.draft.date).catch(() => undefined);
    }
    session.history.push({ role: 'assistant', content: said });
    observeSemanticSignalsShadow(session, {
      transcript,
      reply: said,
      previousQuestion:
        historyBefore.filter((message) => message.role === 'assistant').at(-1)?.content ?? null,
      activeInteraction: 'none',
      turnId,
      agentInterpretation: final.interpretation,
    });
    recordVoiceTurnEventIfCurrent(session, turnId, 'llm_completed', {
      mode: 'structured',
      durationMs: Date.now() - startedAt,
      characterCount: said.length,
    });
    await flushSpeech();
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
  } catch (err) {
    if (!isLive()) return;
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), callId: session.callControlId },
      '[structured-turn] Turn failed, spoken fallback',
    );
    recordVoiceTurnEventIfCurrent(session, turnId, 'llm_interrupted', {
      mode: 'structured',
      reason: 'error',
      durationMs: Date.now() - startedAt,
    });
    await flushSpeech();
    const fallback = buildLlmFailurePlan(session).reply;
    session.history.push({ role: 'assistant', content: fallback });
    mgr.transition(session, 'SPEAKING');
    await speakTtsStreamed(session, fallback);
    if (isCurrentResponse()) mgr.transition(session, 'LISTENING');
  } finally {
    // Tour sans phrase (fragment retenu, relance, interruption) : le contexte
    // ouvert d'avance est fermé sans audio.
    if (contextTts && !spokenPhrases.length) contextTts.cancel('unused');
    // Réponse coupée ou échouée : ce qui n'a pas été fixé l'est ici.
    settleDebugSpeech(contextDebugEntry, contextTts?.framesSent ?? 0, false);
    if (session.ttsContext === contextTts) session.ttsContext = null;
  }
}
