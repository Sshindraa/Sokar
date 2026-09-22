/**
 * Provider LLM vocal — source de vérité unique.
 *
 * Un seul provider depuis le 22 septembre 2026 : Groq en direct. Le chemin
 * vocal n'effectue aucun routage secondaire.
 *
 * Les métadonnées d'appel (SafeProviderConfig, `Call.llmProvider`) doivent
 * refléter ce provider ; le modèle est exposé séparément par
 * `getVoiceLlmModel()`. Un mélange modèle/provider rend les compteurs
 * mensuels inexploitables.
 */
import { voiceConfig } from '../../env';

export const VOICE_LLM_PROVIDER = 'groq' as const;

export type VoiceLlmProvider = typeof VOICE_LLM_PROVIDER;

export function getVoiceLlmProvider(): VoiceLlmProvider {
  return VOICE_LLM_PROVIDER;
}

/** Modèle réellement envoyé à l'API Groq pour les appels vocaux. */
export function getVoiceLlmModel(): string {
  return voiceConfig.VOICE_LLM_MODEL;
}

/**
 * Métadonnées opérationnelles : la clé OpenRouter peut exister pour un outil
 * externe sans que le chemin vocal ne l'utilise. `provider` et `model` restent
 * la preuve de l'appel effectivement routé.
 */
export function getVoiceLlmRuntimeInfo(): {
  provider: VoiceLlmProvider;
  model: string;
  openrouterKeyConfigured: boolean;
  openrouterUsed: boolean;
} {
  const provider = getVoiceLlmProvider();
  return {
    provider,
    model: getVoiceLlmModel(),
    openrouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    // Keep this comparison explicit even though the active provider type is
    // currently narrowed to Groq; it documents the operational distinction
    // and remains correct if a provider is added later.
    openrouterUsed: String(provider) === 'openrouter',
  };
}
