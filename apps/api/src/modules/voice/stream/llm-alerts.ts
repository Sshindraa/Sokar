import { randomUUID } from 'node:crypto';
import { redisCache } from '../../../shared/redis/client';
import { dispatchAlert } from '../../../shared/observability/alert-dispatcher';
import { logger } from '../../../shared/logger/pino';

/**
 * Alertes sur le modèle vocal. `/health` reste vert quand Cerebras refuse (quota 402) : le 29/09,
 * l'agent était muet alors que l'API répondait. Les charges utiles ne contiennent aucune donnée
 * d'appel, seulement des compteurs ; chaque alerte a un délai de silence (une par fenêtre).
 */
const HOUR_SECONDS = 60 * 60;
const TERMINAL_COOLDOWN_SECONDS = HOUR_SECONDS;
const BOTH_DOWN_WINDOW_SECONDS = 10 * 60;
const BOTH_DOWN_COOLDOWN_SECONDS = 30 * 60;
export const LLM_BOTH_DOWN_THRESHOLD = 3;
const HEDGE_WINDOW_SECONDS = 15 * 60;
const HEDGE_COOLDOWN_SECONDS = HOUR_SECONDS;
export const LLM_HEDGE_BURST_THRESHOLD = 10;
const BREAKER_COOLDOWN_SECONDS = 30 * 60;

const KEY = 'sokar:voice:llm';

export type LlmAlertStore = {
  set(
    key: string,
    value: string,
    expiryMode: 'EX',
    ttlSeconds: number,
    condition: 'NX',
  ): Promise<string | null>;
  zadd(key: string, score: number, member: string): Promise<number>;
  zremrangebyscore(key: string, min: string, max: string): Promise<number>;
  zcount(key: string, min: number, max: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<number>;
};

export interface LlmAlertDependencies {
  readonly store: LlmAlertStore;
  readonly dispatch: typeof dispatchAlert;
  readonly now?: () => number;
}

const defaultDependencies: LlmAlertDependencies = { store: redisCache, dispatch: dispatchAlert };

async function dispatchClaimed(
  key: string,
  ttlSeconds: number,
  payload: Parameters<typeof dispatchAlert>[0],
  dependencies: LlmAlertDependencies,
): Promise<boolean> {
  try {
    const claimed = (await dependencies.store.set(key, '1', 'EX', ttlSeconds, 'NX')) === 'OK';
    if (!claimed) return false;
    await dependencies.dispatch(payload);
    return true;
  } catch (error) {
    // Redis en panne : on n'alerte pas plutôt que d'envoyer le même message en boucle.
    logger.warn({ err: error }, '[llm-alerts] Alert skipped because the cooldown failed');
    return false;
  }
}

/** Compte des événements dans une fenêtre glissante et renvoie leur nombre. */
async function countInWindow(
  key: string,
  windowSeconds: number,
  dependencies: LlmAlertDependencies,
): Promise<number | null> {
  try {
    const now = dependencies.now?.() ?? Date.now();
    const cutoff = now - windowSeconds * 1_000;
    await dependencies.store.zadd(key, now, randomUUID());
    await dependencies.store.zremrangebyscore(key, '-inf', `(${cutoff}`);
    const count = await dependencies.store.zcount(key, cutoff, '+inf');
    if ((await dependencies.store.expire(key, windowSeconds)) !== 1) return null;
    return count;
  } catch (error) {
    logger.warn({ err: error }, '[llm-alerts] Could not count events');
    return null;
  }
}

/** Le principal refuse durablement (quota épuisé ou clé refusée) : une alerte par heure. */
export function alertLlmPrimaryUnavailable(
  reason: 'quota' | 'auth',
  dependencies: LlmAlertDependencies = defaultDependencies,
): Promise<boolean> {
  return dispatchClaimed(
    `${KEY}:terminal:${reason}`,
    TERMINAL_COOLDOWN_SECONDS,
    {
      kind: `voice_llm_${reason}`,
      severity: 'critical',
      summary:
        reason === 'quota'
          ? 'Cerebras refuse les requêtes vocales : quota épuisé (402)'
          : 'Cerebras refuse les requêtes vocales : clé API rejetée',
      detail: [
        `reason=${reason}`,
        "Le repli OpenRouter prend le relais s'il est configuré et crédité.",
        reason === 'quota'
          ? 'Action : recharger le compte Cerebras.'
          : 'Action : vérifier CEREBRAS_API_KEY.',
      ].join('\n'),
    },
    dependencies,
  );
}

/** Le principal ET le repli ont échoué pour un tour : l'appelant n'a rien entendu. */
export async function recordLlmBothProvidersFailed(
  dependencies: LlmAlertDependencies = defaultDependencies,
): Promise<boolean> {
  const failures = await countInWindow(
    `${KEY}:both-down:window`,
    BOTH_DOWN_WINDOW_SECONDS,
    dependencies,
  );
  if (failures === null || failures < LLM_BOTH_DOWN_THRESHOLD) return false;
  return dispatchClaimed(
    `${KEY}:both-down:cooldown`,
    BOTH_DOWN_COOLDOWN_SECONDS,
    {
      kind: 'voice_llm_all_providers_down',
      severity: 'critical',
      summary: 'Ni Cerebras ni le repli OpenRouter ne répondent : les appels restent muets',
      detail: [
        `failedTurns=${failures}`,
        `windowSeconds=${BOTH_DOWN_WINDOW_SECONDS}`,
        'Action : vérifier les quotas et le crédit (Cerebras, OpenRouter) et les journaux [llm-fallback].',
      ].join('\n'),
    },
    dependencies,
  );
}

/** Une requête de doublon (hedging) est partie : le principal a dépassé le délai de démarrage. */
export async function recordLlmHedgeFired(
  dependencies: LlmAlertDependencies = defaultDependencies,
): Promise<boolean> {
  const fired = await countInWindow(`${KEY}:hedge:window`, HEDGE_WINDOW_SECONDS, dependencies);
  if (fired === null || fired < LLM_HEDGE_BURST_THRESHOLD) return false;
  return dispatchClaimed(
    `${KEY}:hedge:cooldown`,
    HEDGE_COOLDOWN_SECONDS,
    {
      kind: 'voice_llm_primary_slow',
      severity: 'warning',
      summary: 'Cerebras est lent : le doublon de secours est parti plusieurs fois en 15 minutes',
      detail: [
        `hedgeRequests=${fired}`,
        `windowSeconds=${HEDGE_WINDOW_SECONDS}`,
        'Chaque doublon coûte un appel au repli ; sous ce rythme, les appelants ne remarquent rien.',
      ].join('\n'),
    },
    dependencies,
  );
}

/** Le disjoncteur du modèle principal vient de s'ouvrir : les tours passent par le repli. */
export function alertLlmCircuitOpened(
  dependencies: LlmAlertDependencies = defaultDependencies,
): Promise<boolean> {
  return dispatchClaimed(
    `${KEY}:breaker:cooldown`,
    BREAKER_COOLDOWN_SECONDS,
    {
      kind: 'voice_llm_circuit_open',
      severity: 'warning',
      summary:
        'Le modèle vocal principal est ignoré : le disjoncteur est ouvert (repli OpenRouter)',
      detail:
        'Cerebras a échoué ou tardé plusieurs tours de suite ; les tours passent par le repli le temps du délai de reprise (30 s), puis un essai est refait.',
    },
    dependencies,
  );
}
