/**
 * Relance quand l'appelant n'est pas entendu.
 *
 * Appel c5d6b07d (28/09) : l'appelant dit « euh… trois » après « Vous serez
 * combien ? ». Deepgram détecte la parole (deux `speech_final`) mais rend une
 * transcription vide ; rien ne relançait, 12 s de silence, l'appelant raccroche.
 *
 * Deux cas, une seule réponse naturelle — l'agent repose sa dernière question :
 * - `unheard` : une parole détectée sans aucun mot reconnu ;
 * - `silence` : aucune parole après la question de l'agent.
 * Au plus MAX_RECOVERIES_PER_CALL relances par appel, jamais pendant une
 * clôture, et seulement si la dernière réplique de l'agent était une question.
 */
import type { CallSession } from './types';
import type { CallSessionManager } from './manager';
import { speakTtsStreamed } from './tts-handler';
import { parseRestaurantIdList } from './feature-flags';
import { logger } from '../../../shared/logger/pino';

export type NoInputRecoveryKind = 'unheard' | 'silence';

/** Laisse arriver une transcription tardive avant de conclure qu'aucun mot n'a été compris. */
export const UNHEARD_GRACE_MS = 700;
/** Au-delà d'une parole plus ancienne, un `speech_final` vide n'est que du bruit de ligne. */
export const UNHEARD_MAX_SPEECH_AGE_MS = 5_000;
export const MAX_RECOVERIES_PER_CALL = 2;

type Manager = Pick<CallSessionManager, 'transition'>;

interface RecoveryState {
  count: number;
  unheardTimer?: ReturnType<typeof setTimeout>;
  silenceTimer?: ReturnType<typeof setTimeout>;
}

const states = new WeakMap<CallSession, RecoveryState>();

function stateOf(session: CallSession): RecoveryState {
  let state = states.get(session);
  if (!state) {
    state = { count: 0 };
    states.set(session, state);
  }
  return state;
}

export function isNoInputRecoveryEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    restaurantId &&
    parseRestaurantIdList(env.VOICE_NO_INPUT_RECOVERY_RESTAURANT_IDS).includes(restaurantId),
  );
}

export function noInputTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_NO_INPUT_TIMEOUT_MS ?? 7_000);
  return Number.isFinite(parsed) && parsed >= 3_000 && parsed <= 20_000 ? parsed : 7_000;
}

/** Dernière question posée par l'agent (la dernière phrase terminée par « ? »), sinon null. */
export function lastAgentQuestion(session: Pick<CallSession, 'history'>): string | null {
  const last = [...session.history].reverse().find((message) => message.role === 'assistant');
  const content = typeof last?.content === 'string' ? last.content.trim() : '';
  if (!content.endsWith('?')) return null;
  const sentences = content.match(/[^.!?…]+[.!?…]+/gu) ?? [content];
  const question = sentences[sentences.length - 1]?.trim();
  return question && question.endsWith('?') ? question : null;
}

export function recoveryPhrase(kind: NoInputRecoveryKind, question: string): string {
  return kind === 'unheard'
    ? `Pardon, je n'ai pas bien entendu. ${question}`
    : `Vous êtes toujours là ? ${question}`;
}

function canRecover(session: CallSession): boolean {
  return (
    !session.ended &&
    !session.ending &&
    session.state === 'LISTENING' &&
    isNoInputRecoveryEnabled(session.restaurantId) &&
    stateOf(session).count < MAX_RECOVERIES_PER_CALL
  );
}

async function speakRecovery(
  session: CallSession,
  mgr: Manager,
  kind: NoInputRecoveryKind,
): Promise<void> {
  if (!canRecover(session)) return;
  const question = lastAgentQuestion(session);
  if (!question) return;
  const phrase = recoveryPhrase(kind, question);
  const state = stateOf(session);
  state.count++;
  logger.info(
    { callId: session.callControlId, kind, recovery: state.count },
    '[voice] No-input recovery',
  );
  if (!mgr.transition(session, 'SPEAKING')) return;
  session.history.push({ role: 'assistant', content: phrase });
  try {
    await speakTtsStreamed(session, phrase);
  } finally {
    if (!session.ended && session.state === 'SPEAKING') mgr.transition(session, 'LISTENING');
  }
}

/** Parole détectée sans mot reconnu : relance après un court délai, sauf si un mot arrive. */
export function scheduleUnheardRecovery(session: CallSession, mgr: Manager): void {
  if (!isNoInputRecoveryEnabled(session.restaurantId)) return;
  const speechAt = session.sttLastSpeechStartedAt;
  if (speechAt === undefined || Date.now() - speechAt > UNHEARD_MAX_SPEECH_AGE_MS) return;
  const state = stateOf(session);
  if (state.unheardTimer) clearTimeout(state.unheardTimer);
  clearSilenceTimer(state);
  state.unheardTimer = setTimeout(() => {
    state.unheardTimer = undefined;
    speakRecovery(session, mgr, 'unheard').catch((err: unknown) =>
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[voice] No-input recovery failed',
      ),
    );
  }, UNHEARD_GRACE_MS);
  state.unheardTimer.unref?.();
}

/** À la fin d'une réplique de l'agent : relance si l'appelant ne dit rien. */
export function armSilenceRecovery(session: CallSession, mgr: Manager): void {
  if (!isNoInputRecoveryEnabled(session.restaurantId)) return;
  const state = stateOf(session);
  clearSilenceTimer(state);
  state.silenceTimer = setTimeout(() => {
    state.silenceTimer = undefined;
    speakRecovery(session, mgr, 'silence').catch((err: unknown) =>
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[voice] No-input recovery failed',
      ),
    );
  }, noInputTimeoutMs());
  state.silenceTimer.unref?.();
}

function clearSilenceTimer(state: RecoveryState): void {
  if (state.silenceTimer) clearTimeout(state.silenceTimer);
  state.silenceTimer = undefined;
}

/** L'appelant parle (ou un mot est reconnu) : aucune relance en attente ne doit partir. */
export function cancelNoInputRecovery(session: CallSession): void {
  const state = states.get(session);
  if (!state) return;
  if (state.unheardTimer) clearTimeout(state.unheardTimer);
  state.unheardTimer = undefined;
  clearSilenceTimer(state);
}
