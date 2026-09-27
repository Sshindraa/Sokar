/**
 * Provider LLM vocal — source de vérité unique.
 *
 * Fournisseur unique : Cerebras (API OpenAI-compatible). Le tour structuré a
 * un secours OpenRouter en cas de panne (voir manager.ts).
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
export function getVoiceLlmEndpoint(): {
  baseUrl: string;
  apiKey: string | undefined;
} {
  return { baseUrl: voiceConfig.CEREBRAS_BASE_URL, apiKey: voiceConfig.CEREBRAS_API_KEY };
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
