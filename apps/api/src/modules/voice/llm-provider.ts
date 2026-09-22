/**
 * Provider LLM vocal — source de vérité unique.
 *
 * Un seul provider depuis le 22 septembre 2026 : Groq en direct. Les anciens
 * chemins Cerebras et OpenRouter (provider alternatif et repli) ont été
 * supprimés pour ne laisser qu'un chemin d'appel.
 *
 * Les métadonnées d'appel (SafeProviderConfig, `Call.llmProvider`) doivent
 * refléter ce provider, jamais le modèle : un mélange modèle/provider rend les
 * compteurs mensuels inexploitables.
 */
export const VOICE_LLM_PROVIDER = 'groq' as const;

export type VoiceLlmProvider = typeof VOICE_LLM_PROVIDER;

export function getVoiceLlmProvider(): VoiceLlmProvider {
  return VOICE_LLM_PROVIDER;
}
