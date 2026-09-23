/**
 * Chargé avant `src/test/setup.ts`, qui remplace GROQ_API_KEY par une valeur
 * factice : on conserve ici la vraie clé pour le banc d'évaluation.
 */
process.env.VOICE_EVAL_GROQ_API_KEY ??= process.env.GROQ_API_KEY ?? '';
