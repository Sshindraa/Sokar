import type { CallSession } from './types';

/**
 * Active la pré-réflexion LLM, éventuellement limitée à une liste de canaris.
 * Une liste vide conserve le comportement global pour les déploiements validés.
 */
export function isSpeculativeLlmEnabled(session: Pick<CallSession, 'restaurantId'>): boolean {
  if (process.env.SPECULATIVE_LLM_ENABLED !== 'true') return false;

  const restaurantIds = (process.env.SPECULATIVE_LLM_RESTAURANT_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return restaurantIds.length === 0 || restaurantIds.includes(session.restaurantId);
}
