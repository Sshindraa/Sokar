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

export interface CallerVoiceActivity {
  noiseFloor: number;
  voiceRun: number;
  lastVoiceAt?: number;
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
