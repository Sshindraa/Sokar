/**
 * Détecteur de voix de l'appelant, sur l'audio entrant. Il ne comprend rien : il sait seulement
 * si du son a été reçu depuis un instant. Les fins de tour forcées (partielle figée, jugement du
 * modèle) s'en servent pour ne pas couper quelqu'un qui parle encore ou qui reprend son souffle
 * (appel 5cebe456 : 11 fins de tour sur 17 tombaient pendant la parole).
 *
 * Calé sur l'enregistrement de cet appel, piste appelant, contre les mots réellement prononcés :
 * seuil RMS 300 et deux trames consécutives, 15 fins de tour sur 17 bien classées, aucune manquée.
 */
import { decodeTelnyxToPcm16, telnyxBytesPerMs } from './telnyx-codec';
import type { CallSession } from './types';

/** Sous ce niveau (RMS, échantillons 16 bits), c'est du silence ou un bruit de ligne. */
const MIN_VOICE_RMS = 300;
/** Au-dessus, même un bruit de fond fort ne doit pas masquer la voix. */
const MAX_VOICE_RMS = 1_200;
/** La voix doit dépasser le bruit de fond de cette marge. */
const NOISE_MARGIN = 3;
/** Une trame isolée (clic, souffle) n'est pas de la voix. */
const VOICE_RUN_CHUNKS = 2;
/** Le bruit de fond monte lentement (constante ~20 s) et jamais au-delà : la voix ne le relève pas. */
const FLOOR_RISE = 0.001;
const FLOOR_CEILING = 800;
/**
 * Parole claire : niveau et durée qu'un écho de l'agent n'atteint pas. Mesuré sur les appels des 29 et
 * 30/09 : l'écho revenait à un niveau médian de 20 (0 avec Krisp) et à moins de 2 % du niveau émis au
 * 90e centile, alors que la voix de l'appelant est à plusieurs milliers.
 */
const CLEAR_VOICE_RMS = 800;
const CLEAR_VOICE_MS = 160;

/** Moins d'audio suivi que cela : trop peu pour constater un silence. */
const MIN_JUDGED_AUDIO_MS = 500;

export interface CallerVoiceActivity {
  noiseFloor: number;
  /** Durée d'audio de l'appelant suivie depuis le début de l'appel, en ms. */
  trackedMs?: number;
  voiceRun: number;
  lastVoiceAt?: number;
  /** Durée continue de parole claire en cours, en ms. */
  clearRunMs?: number;
  /** Dernier instant où l'appelant parlait clairement depuis au moins CLEAR_VOICE_MS. */
  lastClearVoiceAt?: number;
}

/** Niveau efficace d'un bloc PCM 16 bits petit-boutiste. */
export function chunkRms(pcmLe: Buffer): number {
  const samples = Math.floor(pcmLe.length / 2);
  if (samples === 0) return 0;
  let sum = 0;
  for (let index = 0; index < samples; index++) {
    const value = pcmLe.readInt16LE(index * 2);
    sum += value * value;
  }
  return Math.sqrt(sum / samples);
}

/** À appeler pour chaque bloc audio reçu de Telnyx (piste de l'appelant). */
export function trackCallerVoice(
  session: CallSession,
  telnyxAudio: Buffer,
  now = Date.now(),
): { rms: number; chunkMs: number } {
  const state = (session.callerVoice ??= { noiseFloor: 0, voiceRun: 0 });
  const rms = chunkRms(decodeTelnyxToPcm16(session.codec, telnyxAudio));
  const chunkMs = telnyxAudio.length / telnyxBytesPerMs(session.codec);
  state.trackedMs = (state.trackedMs ?? 0) + chunkMs;
  if (rms > CLEAR_VOICE_RMS) {
    state.clearRunMs = (state.clearRunMs ?? 0) + chunkMs;
    if (state.clearRunMs >= CLEAR_VOICE_MS) state.lastClearVoiceAt = now;
  } else {
    state.clearRunMs = 0;
  }
  const threshold = Math.min(
    MAX_VOICE_RMS,
    Math.max(MIN_VOICE_RMS, state.noiseFloor * NOISE_MARGIN),
  );
  if (rms > threshold) {
    state.voiceRun++;
    if (state.voiceRun >= VOICE_RUN_CHUNKS) state.lastVoiceAt = now;
    return { rms, chunkMs };
  }
  state.voiceRun = 0;
  state.noiseFloor =
    rms < state.noiseFloor
      ? rms
      : Math.min(FLOOR_CEILING, state.noiseFloor + (rms - state.noiseFloor) * FLOOR_RISE);
  return { rms, chunkMs };
}

/** Durée sans voix, en ms ; infinie tant qu'aucune voix n'a été entendue. */
export function callerSilenceMs(session: CallSession, now = Date.now()): number {
  const lastVoiceAt = session.callerVoice?.lastVoiceAt;
  return lastVoiceAt === undefined ? Number.POSITIVE_INFINITY : Math.max(0, now - lastVoiceAt);
}

/** L'appelant a parlé clairement (niveau et durée d'une vraie voix, pas d'un écho) depuis cet instant. */
export function callerSpokeClearlySince(session: CallSession, sinceMs: number): boolean {
  const lastClearVoiceAt = session.callerVoice?.lastClearVoiceAt;
  return lastClearVoiceAt !== undefined && lastClearVoiceAt >= sinceMs;
}

/**
 * L'audio entrant suivi ne contient aucune voix depuis cet instant. Sert à écarter une transcription
 * que rien n'a produit (appel 30172d22 : piste appelant muette, et pourtant « bon » puis « bonjour »
 * coupaient l'agent à chaque réponse). Sans assez d'audio suivi on ne juge pas : seul un silence
 * constaté disqualifie, jamais l'absence d'information.
 */
export function noCallerVoiceSince(session: CallSession, sinceMs: number): boolean {
  const state = session.callerVoice;
  if (!state || (state.trackedMs ?? 0) < MIN_JUDGED_AUDIO_MS) return false;
  return state.lastVoiceAt === undefined || state.lastVoiceAt < sinceMs;
}
