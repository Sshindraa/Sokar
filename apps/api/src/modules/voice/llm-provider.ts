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
 * Restaurants dont le tour structuré part d'abord chez OpenRouter (VOICE_LLM_OPENROUTER_PRIMARY_RESTAURANT_IDS),
 * avec le modèle et les réglages du relais ; Cerebras devient leur doublon et leur repli.
 * `*` dans la liste vaut pour tous les restaurants, y compris ceux créés après le réglage.
 */
export function isOpenRouterPrimaryFor(restaurantId: string | null | undefined): boolean {
  if (!restaurantId) return false;
  const ids = (voiceConfig.VOICE_LLM_OPENROUTER_PRIMARY_RESTAURANT_IDS ?? '')
    .split(',')
    .map((id) => id.trim());
  return ids.includes('*') || ids.includes(restaurantId);
}

/**
 * Restaurants (ou `*`) dont le tour, quand il part chez OpenRouter en principal, est envoyé en deux
 * requêtes identiques simultanées (VOICE_LLM_OPENROUTER_PARALLEL_RESTAURANT_IDS).
 */
export function isOpenRouterParallelFor(restaurantId: string | null | undefined): boolean {
  if (!restaurantId) return false;
  const ids = (voiceConfig.VOICE_LLM_OPENROUTER_PARALLEL_RESTAURANT_IDS ?? '')
    .split(',')
    .map((id) => id.trim());
  return ids.includes('*') || ids.includes(restaurantId);
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
