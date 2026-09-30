/**
 * Coupure rapide de l'agent quand l'appelant prend la parole. Le barge-in par transcription attend la
 * première partielle de Deepgram (0,7 à 1,3 s après le début de parole dans l'appel 5cebe456) : pendant
 * ce temps l'agent parle par-dessus. Ici le détecteur de voix sur l'audio entrant réagit en ~0,14 s.
 *
 * Comme l'écho de l'agent peut déclencher le détecteur, on ne coupe pas pour de bon : on met la lecture
 * EN PAUSE (l'agent se tait, la réponse reste prête), puis on confirme. Si la transcription confirme
 * une vraie prise de parole, le barge-in habituel coupe. Sinon, au bout de `confirmMs` : appelant encore
 * en train de parler → coupure ; silence → la lecture reprend (faux déclenchement : l'appelant entend
 * une pause d'au plus `confirmMs`, jamais un agent muet).
 *
 * Calé sur les enregistrements des 29 et 30/09 (piste appelant, avec et sans Krisp) : niveau RMS 800
 * tenu 80 ms, 6 prises de parole sur 7 détectées à 0,14 s en médiane, ~0,8 faux déclenchement par minute
 * de parole de l'agent. Prendre en compte le niveau sortant (écho) ne marche pas : la voix de l'appelant
 * arrive au micro bien plus faible que celle de l'agent, toute la détection disparaissait.
 */
import { callerSilenceMs } from './caller-voice-activity';
import type { CallSessionManager } from './manager';
import type { CallSession } from './types';
import { recordVoiceTurnEvent } from './turn-telemetry';
import { voiceFastBargeInTotal } from '../../../shared/observability/metrics';

/** Durée de voix continue exigée. 0 désactive la coupure rapide. */
export function fastBargeInVoiceMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FAST_BARGE_IN_MS ?? 80);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 500 ? parsed : 80;
}

export function fastBargeInMinRms(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FAST_BARGE_IN_MIN_RMS ?? 800);
  return Number.isFinite(parsed) && parsed >= 200 && parsed <= 6_000 ? parsed : 800;
}

/** Durée maximale de la pause avant de trancher : reprise de la lecture, ou coupure. */
export function fastBargeInConfirmMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FAST_BARGE_IN_CONFIRM_MS ?? 500);
  return Number.isFinite(parsed) && parsed >= 200 && parsed <= 1_500 ? parsed : 500;
}

/** Silence minimal de l'appelant, à l'échéance, pour considérer le déclenchement comme une fausse alerte. */
const QUIET_AT_CONFIRM_MS = 200;

export interface FastBargeInState {
  voicedMs: number;
  paused: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

/** Fin de la pause (vraie coupure ou fin d'appel) : plus rien à confirmer. */
export function clearFastBargeIn(session: CallSession): void {
  const state = session.fastBargeIn;
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = undefined;
  state.paused = false;
  state.voicedMs = 0;
}

/**
 * À appeler pour chaque bloc audio de l'appelant, avec son niveau et sa durée. Ne fait rien tant que
 * l'agent ne parle pas ou que la voix n'a pas duré assez.
 */
export function checkFastBargeIn(
  session: CallSession,
  level: { rms: number; chunkMs: number },
  mgr: CallSessionManager,
): void {
  const needMs = fastBargeInVoiceMs();
  if (needMs <= 0) return;
  const state = (session.fastBargeIn ??= { voicedMs: 0, paused: false });
  if (state.paused) return;
  const context = session.ttsContext;
  const agentSpeaking =
    session.state === 'SPEAKING' &&
    session.agentAudioActive === true &&
    typeof context?.pause === 'function';
  if (!agentSpeaking) {
    state.voicedMs = 0;
    return;
  }
  state.voicedMs = level.rms > fastBargeInMinRms() ? state.voicedMs + level.chunkMs : 0;
  if (state.voicedMs < needMs) return;

  state.voicedMs = 0;
  state.paused = true;
  context.pause?.();
  voiceFastBargeInTotal.inc({ outcome: 'paused' });
  recordVoiceTurnEvent(session, 'fast_barge_in', { outcome: 'paused' });
  state.timer = setTimeout(() => settleFastBargeIn(session, mgr), fastBargeInConfirmMs());
  state.timer.unref?.();
}

function settleFastBargeIn(session: CallSession, mgr: CallSessionManager): void {
  const state = session.fastBargeIn;
  if (!state?.paused) return;
  state.paused = false;
  state.timer = undefined;
  // Un barge-in par transcription a déjà tranché (ou l'appel est fini) : rien à faire.
  if (session.ended || session.state !== 'SPEAKING') return;
  if (callerSilenceMs(session) < QUIET_AT_CONFIRM_MS) {
    voiceFastBargeInTotal.inc({ outcome: 'escalated' });
    recordVoiceTurnEvent(session, 'fast_barge_in', { outcome: 'escalated' });
    session.sttAfterBargeIn = true;
    session.abortController?.abort();
    session.abortController = null;
    mgr.handleBargeIn(session);
    return;
  }
  voiceFastBargeInTotal.inc({ outcome: 'resumed' });
  recordVoiceTurnEvent(session, 'fast_barge_in', { outcome: 'resumed' });
  session.ttsContext?.resume?.();
}
