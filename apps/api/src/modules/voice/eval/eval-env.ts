/**
 * Chargé avant `src/test/setup.ts`, qui remplace GROQ_API_KEY par une valeur
 * factice. En CI, le banc utilise sa clé dédiée VOICE_EVAL_GROQ_API_KEY ; en
 * local, GROQ_API_KEY sert de repli.
 */
if (!process.env.VOICE_EVAL_GROQ_API_KEY) {
  process.env.VOICE_EVAL_GROQ_API_KEY = process.env.GROQ_API_KEY ?? '';
}
