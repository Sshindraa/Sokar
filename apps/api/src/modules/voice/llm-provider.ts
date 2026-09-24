/**
 * Provider LLM vocal — source de vérité unique.
 *
 * Un seul provider actif à la fois, choisi par `VOICE_LLM_PROVIDER` (Groq par
 * défaut, Cerebras en option). Les deux exposent une API OpenAI-compatible ;
 * le chemin vocal n'effectue aucun routage secondaire ni repli entre eux.
 *
 * Les métadonnées d'appel (SafeProviderConfig, `Call.llmProvider`) doivent
 * refléter ce provider ; le modèle est exposé séparément par
 * `getVoiceLlmModel()`. Un mélange modèle/provider rend les compteurs
 * mensuels inexploitables.
 */
import type { VoiceLlmProviderName } from '@sokar/config';
import { voiceConfig } from '../../env';

export type VoiceLlmProvider = VoiceLlmProviderName;

export function getVoiceLlmProvider(): VoiceLlmProvider {
  return voiceConfig.VOICE_LLM_PROVIDER;
}

/** Modèle réellement envoyé au provider actif pour les appels vocaux. */
export function getVoiceLlmModel(): string {
  return voiceConfig.VOICE_LLM_MODEL;
}

/** URL de base et clé du provider actif. */
export function getVoiceLlmEndpoint(): { baseUrl: string; apiKey: string | undefined } {
  if (getVoiceLlmProvider() === 'cerebras') {
    return { baseUrl: voiceConfig.CEREBRAS_BASE_URL, apiKey: voiceConfig.CEREBRAS_API_KEY };
  }
  return { baseUrl: voiceConfig.GROQ_BASE_URL, apiKey: voiceConfig.GROQ_API_KEY };
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
    // OpenRouter ne fait pas partie des providers vocaux ; la comparaison reste
    // explicite pour documenter la distinction opérationnelle.
    openrouterUsed: String(provider) === 'openrouter',
  };
}
