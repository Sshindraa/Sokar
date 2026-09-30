/**
 * Attente avant le premier son d'une réponse : la réponse est déjà calculée (texte et voix), mais
 * elle ne part que si l'appelant est silencieux depuis `VOICE_FIRST_AUDIO_SILENCE_MS`. S'il reprend
 * la parole pendant l'attente, la réponse est jetée sans qu'il ait entendu un mot. Avant le premier
 * son, l'écho de l'agent n'existe pas : le détecteur de voix de l'appelant est fiable et annule tout
 * de suite, sans attendre la transcription (0,5 à 1 s plus tard).
 *
 * Appel 5cebe456 : l'agent lâchait un ou deux mots (« Bonjour. », « 5, ») quand l'appelant reprenait
 * après une pause. Rejoué sur l'enregistrement, avec 600 ms : 4 réponses sur 18 annulées avant d'avoir
 * fait un bruit (celles qui étaient coupées), 11 partent sans retard, 3 retenues de 80 à 440 ms.
 */
import { callerSilenceMs } from './caller-voice-activity';
import type { CallSession } from './types';

export type FirstAudioHoldOutcome =
  | 'released_immediate'
  | 'released_after_hold'
  | 'released_at_cap'
  | 'cancelled_voice_resumed'
  | 'aborted';

const POLL_MS = 20;

/** Silence exigé avant le premier son. 0 désactive l'attente. */
export function firstAudioSilenceMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FIRST_AUDIO_SILENCE_MS ?? 600);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2_000 ? parsed : 600;
}

/** Attente maximale : au-delà, la réponse part quand même (bruit, écho). */
export function firstAudioHoldCapMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.VOICE_FIRST_AUDIO_HOLD_CAP_MS ?? 1_200);
  return Number.isFinite(parsed) && parsed >= 200 && parsed <= 5_000 ? parsed : 1_200;
}

export async function holdFirstAudioForCallerSilence(
  session: CallSession,
  shouldContinue: () => boolean,
): Promise<{ outcome: FirstAudioHoldOutcome; heldMs: number }> {
  const silenceMs = firstAudioSilenceMs();
  const startedAt = Date.now();
  if (silenceMs <= 0 || callerSilenceMs(session, startedAt) >= silenceMs) {
    return { outcome: 'released_immediate', heldMs: 0 };
  }
  const capMs = firstAudioHoldCapMs();
  const voiceAtStart = session.callerVoice?.lastVoiceAt;
  while (shouldContinue()) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const now = Date.now();
    const heldMs = now - startedAt;
    const lastVoiceAt = session.callerVoice?.lastVoiceAt;
    if (lastVoiceAt !== undefined && lastVoiceAt > (voiceAtStart ?? 0)) {
      return { outcome: 'cancelled_voice_resumed', heldMs };
    }
    if (callerSilenceMs(session, now) >= silenceMs)
      return { outcome: 'released_after_hold', heldMs };
    if (heldMs >= capMs) return { outcome: 'released_at_cap', heldMs };
  }
  return { outcome: 'aborted', heldMs: Date.now() - startedAt };
}
