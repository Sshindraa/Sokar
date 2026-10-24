/**
 * Garde-fou des scripts `nb-*` : le banc ne touche jamais une clé de
 * production. Le 24/09, un run de banc sur le compte ElevenLabs partagé
 * prod/staging a épuisé le quota et coupé la transcription des appels réels.
 *
 * Règle : les bancs Deepgram et Cartesia lisent chacun une clé dédiée et refusent une clé identique à
 * celle du runtime. Le banc ElevenLabs lit la clé unique `ELEVENLABS_API_KEY` (décision du
 * 14/10/2026 : une seule clé partagée prod, dev, staging et banc).
 * Les valeurs ne sont jamais journalisées, seulement comparées.
 */

export type BenchProviderKey = 'CARTESIA_BENCH_API_KEY' | 'DEEPGRAM_BENCH_API_KEY';

/** La durée de silence final ajoutée après chaque clip dans `nb-run.ts`. */
export const BENCH_TRAILING_SILENCE_S = 1.6;

/** Au-delà de ce nombre de clips, `BENCH_CONFIRM=1` est obligatoire. */
export const BENCH_CONFIRM_LIMIT = 8;
const BENCH_KEYTERM_COST_FACTOR = 1.2;
const BENCH_STT_USD_PER_HOUR = 0.39;

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

/** Refuse les appels Cartesia sans plafond de crédits explicite et suffisant. */
export function requireBenchCreditBudget(estimatedCredits: number): number {
  const maxCredits = Number(process.env.BENCH_MAX_CREDITS);
  if (!Number.isFinite(maxCredits) || maxCredits <= 0) {
    throw new Error('BENCH_MAX_CREDITS doit définir un plafond positif avant un banc Cartesia.');
  }
  if (!Number.isFinite(estimatedCredits) || estimatedCredits < 0) {
    throw new Error('Estimation de crédits Cartesia invalide.');
  }
  if (estimatedCredits > maxCredits) {
    throw new Error(
      `Budget Cartesia dépassé : ${estimatedCredits.toFixed(1)} crédits estimés, plafond ${maxCredits}.`,
    );
  }
  return maxCredits;
}

/** Clé ElevenLabs unique, partagée prod, dev, staging et banc (décision du 14/10/2026). */
export function requireSharedKey(envName: 'ELEVENLABS_API_KEY'): string {
  const value = process.env[envName]?.trim();
  if (!value) throw new Error(`${envName} est requise pour le banc.`);
  return value;
}

export interface BenchCostEstimate {
  clips: number;
  sessions: number;
  estimatedAudioSeconds: number;
  estimatedTtsCharacters: number;
  estimatedUsd: number;
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
  extraSessions = 0,
  extraAudioSeconds = 0,
): BenchCostEstimate {
  const perClipSeconds = texts.reduce((sum, text) => sum + Math.max(1.2, text.length / 13), 0);
  const sessions = texts.length * conditions * sessionsPerCondition + extraSessions;
  const repeats = conditions * sessionsPerCondition;
  const estimatedAudioSeconds =
    perClipSeconds * repeats +
    texts.length * conditions * sessionsPerCondition * BENCH_TRAILING_SILENCE_S +
    extraAudioSeconds;
  return {
    clips: texts.length,
    sessions,
    estimatedAudioSeconds,
    estimatedTtsCharacters: texts.reduce((sum, text) => sum + text.length, 0),
    estimatedUsd:
      (estimatedAudioSeconds / 3600) * BENCH_STT_USD_PER_HOUR * BENCH_KEYTERM_COST_FACTOR,
  };
}

export function formatCostEstimate(estimate: BenchCostEstimate): string {
  const minutes = estimate.estimatedAudioSeconds / 60;
  return (
    `Estimation de coût avant envoi : ${estimate.clips} clips → ${estimate.sessions} sessions Scribe, ` +
    `~${estimate.estimatedAudioSeconds.toFixed(0)} s d'audio streamé (~${minutes.toFixed(1)} min, silence final inclus), ` +
    `~$${estimate.estimatedUsd.toFixed(3)} USD Scribe estimés (base $0.39/h +20 % keyterms), ` +
    `~${estimate.estimatedTtsCharacters} caractères TTS.`
  );
}
