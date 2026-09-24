/**
 * Garde-fou des scripts `nb-*` : le banc ne touche jamais une clé de
 * production. Le 24/09, un run de banc sur le compte ElevenLabs partagé
 * prod/staging a épuisé le quota et coupé la transcription des appels réels.
 *
 * Règle : le banc lit uniquement `ELEVENLABS_BENCH_API_KEY` /
 * `CARTESIA_BENCH_API_KEY`, et refuse une clé identique à celle de prod.
 * Les valeurs ne sont jamais journalisées, seulement comparées.
 */

export type BenchProviderKey = 'ELEVENLABS_BENCH_API_KEY' | 'CARTESIA_BENCH_API_KEY';

/** La durée de silence final ajoutée après chaque clip dans `nb-run.ts`. */
export const BENCH_TRAILING_SILENCE_S = 1.6;

/** Au-delà de ce nombre de clips, `BENCH_CONFIRM=1` est obligatoire. */
export const BENCH_CONFIRM_LIMIT = 8;

export function requireBenchKey(envName: BenchProviderKey, productionEnvName: string): string {
  const value = process.env[envName]?.trim();
  if (!value) {
    throw new Error(
      `${envName} est requis : le banc n'utilise jamais la clé de production (${productionEnvName}). ` +
        `Crée une clé de banc dédiée.`,
    );
  }
  const production = process.env[productionEnvName]?.trim();
  // Comparaison sans journaliser : une clé de banc qui vaut la clé de prod est
  // exactement l'incident du 24/09.
  if (production && production === value) {
    throw new Error(
      `${envName} est identique à ${productionEnvName}. Utilise une clé de banc dédiée, jamais la clé de production.`,
    );
  }
  return value;
}

export interface BenchCostEstimate {
  clips: number;
  sessions: number;
  estimatedAudioSeconds: number;
  estimatedTtsCharacters: number;
}

/**
 * Estimation a priori (avant toute synthèse) : durée approximative par longueur
 * de texte (~13 caractères/seconde en français) majorée d'un plancher, plus le
 * silence final envoyé à Scribe pour chaque session.
 */
export function estimateBenchCost(
  texts: readonly string[],
  conditions: number,
  sessionsPerCondition: number,
): BenchCostEstimate {
  const perClipSeconds = texts.reduce((sum, text) => sum + Math.max(1.2, text.length / 13), 0);
  const sessions = texts.length * conditions * sessionsPerCondition;
  const repeats = conditions * sessionsPerCondition;
  return {
    clips: texts.length,
    sessions,
    estimatedAudioSeconds: perClipSeconds * repeats + sessions * BENCH_TRAILING_SILENCE_S,
    estimatedTtsCharacters: texts.reduce((sum, text) => sum + text.length, 0),
  };
}

export function formatCostEstimate(estimate: BenchCostEstimate): string {
  const minutes = estimate.estimatedAudioSeconds / 60;
  return (
    `Estimation de coût avant envoi : ${estimate.clips} clips → ${estimate.sessions} sessions Scribe, ` +
    `~${estimate.estimatedAudioSeconds.toFixed(0)} s d'audio streamé (~${minutes.toFixed(1)} min, silence final inclus), ` +
    `~${estimate.estimatedTtsCharacters} caractères TTS.`
  );
}
