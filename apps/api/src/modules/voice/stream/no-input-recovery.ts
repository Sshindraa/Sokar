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
 *
 * Appel 126f433a (29/09) : après l'accueil « Je vous écoute. » (qui n'est pas une
 * question), l'appelant ne dit rien d'intelligible et l'agent reste muet 15 s.
 * Tant que l'appelant n'a rien dit, on relance donc avec une question d'ouverture.
 */
import type { CallSession } from './types';
import type { CallSessionManager } from './manager';
import { speakTtsStreamed } from './tts-handler';
import { generateRecoveryReply } from './structured-turn/engine';
import { parseRestaurantIdList } from './feature-flags';
import { logger } from '../../../shared/logger/pino';

export type NoInputRecoveryKind = 'unheard' | 'silence';

/** Laisse arriver une transcription tardive avant de conclure qu'aucun mot n'a été compris. */
export const UNHEARD_GRACE_MS = 700;
/** Au-delà d'une parole plus ancienne, un `speech_final` vide n'est que du bruit de ligne. */
export const UNHEARD_MAX_SPEECH_AGE_MS = 5_000;
export const MAX_RECOVERIES_PER_CALL = 2;

type Manager = Pick<CallSessionManager, 'transition'> &
  Partial<Pick<CallSessionManager, 'streamStructuredCompletion'>>;

/** Interrupteur : `VOICE_RECOVERY_BY_MODEL=false` (ou 0) rétablit les phrases codées, sans appel au modèle. */
export function recoveryByModelEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.VOICE_RECOVERY_BY_MODEL?.trim().toLowerCase();
  return value !== 'false' && value !== '0';
}

interface RecoveryState {
  count: number;
  /** Formulation en cours : l'appelant qui reprend la parole l'interrompt. */
  generation: number;
  abort?: AbortController;
  unheardTimer?: ReturnType<typeof setTimeout>;
  silenceTimer?: ReturnType<typeof setTimeout>;
}

const states = new WeakMap<CallSession, RecoveryState>();

function stateOf(session: CallSession): RecoveryState {
  let state = states.get(session);
  if (!state) {
    state = { count: 0, generation: 0 };
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

/** Question d'ouverture, quand l'appelant n'a encore rien dit après l'accueil. */
export const OPENING_RECOVERY_QUESTION = 'Comment puis-je vous aider ?';

/** Ce que l'agent redemande : sa dernière question, ou l'ouverture si personne n'a encore parlé. */
export function recoveryQuestion(session: Pick<CallSession, 'history'>): string | null {
  const question = lastAgentQuestion(session);
  if (question) return question;
  return session.history.some((message) => message.role === 'user')
    ? null
    : OPENING_RECOVERY_QUESTION;
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
  const question = recoveryQuestion(session);
  if (!question) return;
  const state = stateOf(session);
  // Le modèle formule la relance pendant que l'appelant peut encore parler ; sa phrase codée n'est plus
  // que le dernier recours (modèle indisponible, réponse vide ou invalide).
  let phrase: string | null = null;
  if (recoveryByModelEnabled()) {
    const generation = ++state.generation;
    const controller = new AbortController();
    state.abort = controller;
    try {
      phrase = await generateRecoveryReply(
        session,
        mgr,
        kind === 'silence' && !session.history.some((message) => message.role === 'user')
          ? 'opening'
          : kind,
        controller.signal,
      );
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.name : String(err), callId: session.callControlId },
        '[voice] No-input recovery by the model failed, fixed phrase',
      );
    }
    if (state.abort === controller) state.abort = undefined;
    // L'appelant a repris la parole, ou la ligne n'est plus libre : rien à dire, relance non consommée.
    if (controller.signal.aborted || state.generation !== generation || !canRecover(session))
      return;
  }
  const spoken = phrase ?? recoveryPhrase(kind, question);
  state.count++;
  logger.info(
    {
      callId: session.callControlId,
      kind,
      recovery: state.count,
      source: phrase ? 'model' : 'fixed',
    },
    '[voice] No-input recovery',
  );
  if (!mgr.transition(session, 'SPEAKING')) return;
  session.history.push({ role: 'assistant', content: spoken });
  try {
    await speakTtsStreamed(session, spoken);
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
  // Une relance en cours de formulation n'a plus lieu d'être.
  state.generation++;
  state.abort?.abort();
  state.abort = undefined;
  if (state.unheardTimer) clearTimeout(state.unheardTimer);
  state.unheardTimer = undefined;
  clearSilenceTimer(state);
}
