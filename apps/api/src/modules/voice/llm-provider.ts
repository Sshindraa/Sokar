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
 * GPT-6 Luna (OpenRouter, modèle et réglages du relais) est le modèle principal du tour structuré pour tous les
 * restaurants dès que `OPENROUTER_API_KEY` est présente ; Cerebras devient le doublon et le repli. Sans clé,
 * Cerebras reste seul.
 */
export function isOpenRouterPrimaryFor(restaurantId: string | null | undefined): boolean {
  return Boolean(restaurantId && voiceConfig.OPENROUTER_API_KEY?.trim());
}

/**
 * Le tour principal OpenRouter part en deux requêtes identiques simultanées : le premier texte gagne, l'autre est
 * annulée. Coupe les pics de GPT-6 Luna (banc du 20/10), pour tous les restaurants.
 */
export function isOpenRouterParallelFor(restaurantId: string | null | undefined): boolean {
  return isOpenRouterPrimaryFor(restaurantId);
}

/** Fournisseur et modèle principaux d'un restaurant, pour la télémétrie et le rapport d'appel. */
export function voiceLlmRouteFor(restaurantId: string | null | undefined): {
  provider: string;
  model: string;
} {
  return isOpenRouterPrimaryFor(restaurantId)
    ? { provider: 'openrouter', model: voiceConfig.VOICE_STRUCTURED_FALLBACK_MODEL }
    : { provider: getVoiceLlmProvider(), model: getVoiceLlmModel() };
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
