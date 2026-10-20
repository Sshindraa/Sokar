/**
 * Spéculation du tour structuré : dès que la partielle Deepgram est stable, le
 * premier appel au modèle part avec exactement la requête qu'enverrait le tour
 * final. Rien n'est dit ni exécuté : quand la fin de phrase arrive, le moteur
 * reprend ce flux déjà commencé seulement si sa requête est identique au
 * caractère près (même phrase, même historique, même état), sinon il l'abandonne.
 *
 * Rejeu des appels réels du 27/09 : la partielle est déjà la phrase finale dans
 * ~40–50 % des tours, stable ~300–450 ms avant la fin officielle.
 */
import type { CallSession, ChatMessage, VoiceSpeculationCounters } from '../types';
import type { CallSessionManager } from '../manager';
import { logger } from '../../../../shared/logger/pino';
import { ensureVoiceUsage, estimateMessagesTokens } from '../../../usage/voice-usage.service';
import {
  voiceStructuredSpeculationLaunchTotal,
  voiceStructuredSpeculationTotal,
} from '../../../../shared/observability/metrics';

type StructuredFormat = Parameters<CallSessionManager['streamStructuredCompletion']>[2];

interface Speculation {
  key: string;
  messages: ChatMessage[];
  deltas: string[];
  listeners: Set<(delta: string) => void>;
  controller: AbortController;
  done: Promise<string>;
  /** Entrée estimée de la requête, comptée comme gaspillée si elle ne sert pas. */
  inputTokens: number;
}

/** Anticipation d'un tour, journalisée quand le tour la reprend ou la jette : des nombres, jamais de texte. */
export interface SpeculationTurnStats {
  launches: number;
  capped: number;
  replaced: number;
  cancelled: number;
  /** Entrée estimée des anticipations du tour qui n'ont pas servi. */
  discardedInputTokens: number;
}

const speculations = new WeakMap<CallSession, Speculation>();
/** Requêtes spéculatives lancées pour le tour en cours : chacune coûte une requête de ~3 k tokens. */
const launches = new WeakMap<CallSession, number>();
/** Comptes du tour en cours ; contrairement au plafond, ils ne repartent à zéro qu'au tour suivant. */
const turnStats = new WeakMap<CallSession, SpeculationTurnStats>();

function currentTurnStats(session: CallSession): SpeculationTurnStats {
  let stats = turnStats.get(session);
  if (!stats) {
    stats = { launches: 0, capped: 0, replaced: 0, cancelled: 0, discardedInputTokens: 0 };
    turnStats.set(session, stats);
  }
  return stats;
}

function callCounters(session: CallSession): VoiceSpeculationCounters {
  return (ensureVoiceUsage(session).speculation ??= {
    launches: 0,
    capped: 0,
    replaced: 0,
    cancelled: 0,
    hits: 0,
    none: 0,
    misses: {},
    discardedInputTokens: 0,
    discardedInputTokensByCause: {},
  });
}

/** Une anticipation lancée qui ne servira pas : son entrée est facturée quand même. */
function recordDiscarded(
  session: CallSession,
  speculation: Speculation,
  cause: 'replaced' | 'cancelled' | SpeculationOutcome,
): void {
  const stats = currentTurnStats(session);
  const call = callCounters(session);
  if (cause === 'replaced' || cause === 'cancelled') {
    stats[cause] += 1;
    call[cause] += 1;
  }
  stats.discardedInputTokens += speculation.inputTokens;
  call.discardedInputTokens += speculation.inputTokens;
  call.discardedInputTokensByCause[cause] =
    (call.discardedInputTokensByCause[cause] ?? 0) + speculation.inputTokens;
}

/** Plafond de requêtes spéculatives par tour (limite de tokens par minute du fournisseur). */
export function structuredSpeculationMaxLaunches(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_STRUCTURED_SPECULATION_MAX_LAUNCHES ?? 3);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 3;
}

/**
 * Verdict du modèle sur la fin de tour : `turnComplete` est le premier champ du
 * JSON, il arrive donc avant la première phrase. Null tant qu'il n'est pas lisible.
 */
export function parseTurnCompleteVerdict(streamed: string): boolean | null {
  const match = /"turnComplete"\s*:\s*(true|false)/.exec(streamed);
  return match ? match[1] === 'true' : null;
}

function requestKey(messages: ChatMessage[], format: StructuredFormat): string {
  return JSON.stringify([messages, format]);
}

export function isStructuredSpeculationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_STRUCTURED_SPECULATION_ENABLED === 'true';
}

export type SpeculationOutcome =
  | 'hit'
  | 'none'
  | 'miss_format'
  | 'miss_state'
  | 'miss_history'
  | 'miss_transcript_format'
  | 'miss_transcript_extended'
  | 'miss_transcript_shorter'
  | 'miss_transcript_changed';

const normalizeText = (text: unknown): string =>
  String(text ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pourquoi la requête spéculée n'est pas celle du tour final : catégories seulement,
 * jamais le texte (données personnelles). Les causes sont testées de la plus grosse
 * (état vérifié, historique) à la plus fine (ponctuation de la phrase).
 */
export function classifySpeculationMiss(
  speculated: ChatMessage[],
  actual: ChatMessage[],
): SpeculationOutcome {
  const [speculatedSystem, ...speculatedRest] = speculated;
  const [actualSystem, ...actualRest] = actual;
  if (speculatedSystem?.content !== actualSystem?.content) return 'miss_state';
  const speculatedLast = speculatedRest.at(-1);
  const actualLast = actualRest.at(-1);
  const speculatedHistory = JSON.stringify(speculatedRest.slice(0, -1));
  const actualHistory = JSON.stringify(actualRest.slice(0, -1));
  if (speculatedHistory !== actualHistory) return 'miss_history';
  const before = normalizeText(speculatedLast?.content);
  const after = normalizeText(actualLast?.content);
  if (before === after) return 'miss_transcript_format';
  if (after.startsWith(before)) return 'miss_transcript_extended';
  if (before.startsWith(after)) return 'miss_transcript_shorter';
  return 'miss_transcript_changed';
}

/**
 * Écart en mots entre la phrase anticipée et la phrase finale (distance d'édition sur les mots normalisés) :
 * dit si un `miss_transcript_*` est une retouche du STT ou une autre phrase, sans exposer le texte.
 */
export function speculationWordGap(speculated: ChatMessage[], actual: ChatMessage[]): number {
  const words = (messages: ChatMessage[]) =>
    normalizeText(messages.at(-1)?.content).split(' ').filter(Boolean);
  const before = words(speculated);
  const after = words(actual);
  let previous = Array.from({ length: after.length + 1 }, (_, index) => index);
  for (let i = 1; i <= before.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= after.length; j += 1) {
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (before[i - 1] === after[j - 1] ? 0 : 1),
      );
    }
    previous = row;
  }
  return previous[after.length];
}

function recordOutcome(
  session: CallSession,
  outcome: SpeculationOutcome,
  details: { inputTokens?: number; wordGap?: number } = {},
): SpeculationTurnStats {
  voiceStructuredSpeculationTotal.inc({ outcome });
  const stats = currentTurnStats(session);
  turnStats.delete(session);
  const call = callCounters(session);
  if (outcome === 'hit') call.hits += 1;
  else if (outcome === 'none') call.none += 1;
  else call.misses[outcome] = (call.misses[outcome] ?? 0) + 1;
  logger.info(
    {
      callId: session.callControlId,
      outcome,
      ...stats,
      ...(details.inputTokens !== undefined ? { inputTokens: details.inputTokens } : {}),
      ...(details.wordGap !== undefined ? { wordGap: details.wordGap } : {}),
    },
    '[structured-turn] Speculation outcome',
  );
  return stats;
}

/** Lance (ou garde) la requête spéculative ; une requête différente remplace la précédente. */
export function startSpeculation(
  session: CallSession,
  mgr: CallSessionManager,
  messages: ChatMessage[],
  format: StructuredFormat,
  onVerdict?: (turnComplete: boolean) => void,
): void {
  const key = requestKey(messages, format);
  const current = speculations.get(session);
  if (current?.key === key) return;
  const launched = launches.get(session) ?? 0;
  if (launched >= structuredSpeculationMaxLaunches()) {
    voiceStructuredSpeculationLaunchTotal.inc({ result: 'capped' });
    currentTurnStats(session).capped += 1;
    callCounters(session).capped += 1;
    return;
  }
  launches.set(session, launched + 1);
  voiceStructuredSpeculationLaunchTotal.inc({ result: 'started' });
  currentTurnStats(session).launches += 1;
  callCounters(session).launches += 1;
  if (current) {
    current.controller.abort();
    recordDiscarded(session, current, 'replaced');
  }
  const controller = new AbortController();
  let verdictSent = false;
  const speculation: Speculation = {
    key,
    messages,
    deltas: [],
    listeners: new Set(),
    controller,
    done: Promise.resolve(''),
    inputTokens: estimateMessagesTokens(messages),
  };
  // Promise.resolve : une réponse inattendue du gestionnaire ne doit jamais faire d'erreur non gérée.
  speculation.done = Promise.resolve(
    mgr.streamStructuredCompletion(session, messages, format, {
      signal: controller.signal,
      kind: 'speculation',
      onDelta: (delta) => {
        speculation.deltas.push(delta);
        for (const listener of speculation.listeners) listener(delta);
        if (onVerdict && !verdictSent) {
          const verdict = parseTurnCompleteVerdict(speculation.deltas.join(''));
          if (verdict !== null) {
            verdictSent = true;
            onVerdict(verdict);
          }
        }
      },
    }),
  );
  // Une spéculation abandonnée ou échouée n'est jamais une erreur du tour.
  speculation.done.catch(() => undefined);
  speculations.set(session, speculation);
}

/**
 * Reprend la spéculation si sa requête est identique : les fragments déjà reçus
 * sont rejoués, la suite arrive en direct. Sinon elle est abandonnée et null.
 */
export function takeSpeculation(
  session: CallSession,
  messages: ChatMessage[],
  format: StructuredFormat,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
): Promise<string> | null {
  const speculation = speculations.get(session);
  speculations.delete(session);
  launches.delete(session);
  if (!speculation) {
    recordOutcome(session, 'none');
    return null;
  }
  if (speculation.key !== requestKey(messages, format)) {
    speculation.controller.abort();
    const outcome =
      JSON.stringify(speculation.messages) === JSON.stringify(messages)
        ? 'miss_format'
        : classifySpeculationMiss(speculation.messages, messages);
    recordDiscarded(session, speculation, outcome);
    recordOutcome(session, outcome, {
      inputTokens: speculation.inputTokens,
      ...(outcome.startsWith('miss_transcript_')
        ? { wordGap: speculationWordGap(speculation.messages, messages) }
        : {}),
    });
    return null;
  }
  recordOutcome(session, 'hit', { inputTokens: speculation.inputTokens });
  signal.addEventListener('abort', () => speculation.controller.abort(), { once: true });
  for (const delta of speculation.deltas) onDelta(delta);
  speculation.listeners.add(onDelta);
  return speculation.done;
}

export function cancelSpeculation(session: CallSession): void {
  const speculation = speculations.get(session);
  if (speculation) {
    speculation.controller.abort();
    recordDiscarded(session, speculation, 'cancelled');
  }
  speculations.delete(session);
  launches.delete(session);
}
