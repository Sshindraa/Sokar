/**
 * Preuve minimale pour qu'une transcription coupe l'agent, ou ouvre un tour.
 *
 * Appel f2200632 (03/10) : « rouge », un seul mot à 0,28 de confiance et 0,4 s de voix, a coupé
 * l'accueil 1 s après le décroché ; l'agent a ensuite répondu « Je n'ai pas bien saisi ». Critère
 * structurel, sans liste de mots : un mot seul, peu sûr et bref ne prouve pas une prise de parole.
 *
 * Seuil calé sur les 43 interruptions des journaux du 22/09 au 03/10 (confiance minimale des mots
 * du tour qui a suivi, mots seuls uniquement). Fantômes, tous en première réplique et jugés
 * « unclear » : 0,166 ; 0,207 ; 0,278. Prises de parole plausibles : 0,349 ; 0,755 ; 0,862 ; 0,864 ;
 * 0,914. Le seuil de 0,3 tombe dans l'écart entre 0,278 et 0,349. Pendant l'accueil, aucune prise de
 * parole réelle d'un mot n'a été observée sous 0,349 : on exige 0,6, au milieu de l'écart
 * 0,349 – 0,755.
 */
import type { SttWord } from './types';

/** Confiance minimale d'un mot seul pour interrompre ou ouvrir un tour. */
export const SINGLE_WORD_MIN_CONFIDENCE = 0.3;
/** Même exigence pendant l'accueil, où personne n'attend de réponse et où les bruits d'ouverture abondent. */
export const GREETING_SINGLE_WORD_MIN_CONFIDENCE = 0.6;
/** Un mot tenu au moins aussi longtemps est de la voix soutenue, quelle que soit sa confiance. */
export const SUSTAINED_VOICE_MS = 800;

export interface InterruptionEvidence {
  wordCount: number;
  /** Plus faible confiance des mots ; null si le fournisseur n'en donne pas. */
  minConfidence: number | null;
  /** Durée couverte par les mots ; null si les horodatages manquent. */
  voiceMs: number | null;
}

export function describeInterruptionEvidence(
  transcript: string,
  words?: readonly SttWord[],
): InterruptionEvidence {
  const tokens = transcript.match(/[\p{L}\p{N}]+/gu) ?? [];
  const confidences = (words ?? [])
    .map((word) => word.confidence)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const starts = (words ?? [])
    .map((word) => word.start)
    .filter((v): v is number => v !== undefined);
  const ends = (words ?? []).map((word) => word.end).filter((v): v is number => v !== undefined);
  return {
    wordCount: tokens.length,
    minConfidence: confidences.length ? Math.min(...confidences) : null,
    voiceMs:
      starts.length && ends.length
        ? Math.round((Math.max(...ends) - Math.min(...starts)) * 1000)
        : null,
  };
}

/**
 * Faux seulement pour un mot unique dont la confiance est connue et sous le seuil, sans voix
 * soutenue. Sans confiance (fournisseur qui n'en donne pas), on ne bloque rien : aucune donnée.
 */
export function hasInterruptionEvidence(
  evidence: InterruptionEvidence,
  options: { greeting: boolean },
): boolean {
  if (evidence.wordCount !== 1) return true;
  if (evidence.minConfidence === null) return true;
  if (evidence.voiceMs !== null && evidence.voiceMs >= SUSTAINED_VOICE_MS) return true;
  const threshold = options.greeting
    ? GREETING_SINGLE_WORD_MIN_CONFIDENCE
    : SINGLE_WORD_MIN_CONFIDENCE;
  return evidence.minConfidence >= threshold;
}

/** Un tour fait d'un seul mot sans preuve est du bruit : l'agent continue d'écouter. */
export function isNoiseTurn(evidence: InterruptionEvidence): boolean {
  return !hasInterruptionEvidence(evidence, { greeting: false });
}
