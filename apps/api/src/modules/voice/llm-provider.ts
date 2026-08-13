/**
 * Résolution du provider LLM vocal — source de vérité unique.
 *
 * Le provider réel est piloté par VOICE_LLM_PROVIDER ('cerebras' par défaut,
 * 'openrouter' en alternative). Les métadonnées d'appel (SafeProviderConfig,
 * enregistrement Call.llmProvider) doivent refléter CE provider, jamais le
 * modèle — un mélange modèle/providers rend les compteurs mensuels inexploitables.
 */
export type VoiceLlmProvider = 'cerebras' | 'openrouter';

export function getVoiceLlmProvider(): VoiceLlmProvider {
  return process.env.VOICE_LLM_PROVIDER === 'openrouter' ? 'openrouter' : 'cerebras';
}
