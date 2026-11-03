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
/** Un bruit bref peut dépasser deux trames : annuler une réponse exige 160 ms de signal continu. */
const SUSTAINED_VOICE_MS = 160;
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
  /** Durée continue au-dessus du seuil adaptatif (indépendante de la taille des trames). */
  voiceRunMs?: number;
  /** Dernier instant où ce signal était soutenu depuis SUSTAINED_VOICE_MS. */
  lastSustainedVoiceAt?: number;
  /** Durée continue de parole claire en cours, en ms. */
  clearRunMs?: number;
  /** Dernier instant où l'appelant parlait clairement depuis au moins CLEAR_VOICE_MS. */
  lastClearVoiceAt?: number;
  /** Pauses de l'appelant suivies d'une reprise de parole pendant l'écoute (ms, les plus récentes). */
  pauses?: number[];
}

/**
 * Pauses retenues pour connaître la façon de parler de l'appelant. Mesure du 22/10/2026 sur 41 appels
 * enregistrés : le 80e centile des pauses au milieu d'une prise de parole va de 164 à 1 160 ms selon
 * l'appelant (médiane 552 ms) ; un seuil unique couperait les uns ou ferait attendre les autres.
 */
const MIN_PAUSE_MS = 120;
const MAX_PAUSE_MS = 1_500;
const MAX_TRACKED_PAUSES = 20;
const MIN_PAUSES_FOR_ADAPTIVE = 3;
const PAUSE_MARGIN_MS = 150;
const ADAPTIVE_FLOOR_MS = 350;
const ADAPTIVE_CEILING_MS = 1_100;

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
    state.voiceRunMs = (state.voiceRunMs ?? 0) + chunkMs;
    if (state.voiceRunMs >= SUSTAINED_VOICE_MS) state.lastSustainedVoiceAt = now;
    if (state.voiceRun >= VOICE_RUN_CHUNKS) {
      // Reprise de parole pendant l'écoute : la pause qui précède dit comment cet appelant parle.
      if (
        state.voiceRun === VOICE_RUN_CHUNKS &&
        state.lastVoiceAt !== undefined &&
        session.state === 'LISTENING'
      ) {
        const pauseMs = now - state.lastVoiceAt - chunkMs * (VOICE_RUN_CHUNKS - 1);
        if (pauseMs >= MIN_PAUSE_MS && pauseMs <= MAX_PAUSE_MS) {
          const pauses = (state.pauses ??= []);
          pauses.push(Math.round(pauseMs));
          if (pauses.length > MAX_TRACKED_PAUSES) pauses.shift();
        }
      }
      state.lastVoiceAt = now;
    }
    return { rms, chunkMs };
  }
  state.voiceRun = 0;
  state.voiceRunMs = 0;
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

/**
 * Silence au-delà duquel cet appelant a fini sa phrase : 80e centile de ses propres pauses + 150 ms, borné
 * entre 350 et 1 100 ms ; `fallbackMs` tant que moins de 3 pauses ont été observées.
 */
export function callerPauseFinalizeMs(session: CallSession, fallbackMs: number): number {
  const pauses = session.callerVoice?.pauses ?? [];
  if (pauses.length < MIN_PAUSES_FOR_ADAPTIVE) return fallbackMs;
  const sorted = [...pauses].sort((a, b) => a - b);
  const p80 = sorted[Math.floor(0.8 * (sorted.length - 1))];
  return Math.min(ADAPTIVE_CEILING_MS, Math.max(ADAPTIVE_FLOOR_MS, p80 + PAUSE_MARGIN_MS));
}
