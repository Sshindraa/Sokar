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
const FALLBACK_COOLDOWN_SECONDS = 24 * HOUR_SECONDS;

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

/** Pourquoi un tour est resté sans réponse : principal trop lent (file d'attente) ou en erreur. */
export type LlmTurnFailureCause = 'primary_slow' | 'primary_failed';

const FAILURE_CAUSE_DETAIL: Record<LlmTurnFailureCause, string> = {
  primary_slow:
    "Dernier échec : Cerebras n'a renvoyé aucun texte à temps (file d'attente) et aucun secours n'a répondu.",
  primary_failed: 'Dernier échec : Cerebras a renvoyé une erreur et aucun secours n’a répondu.',
};

/**
 * Un tour entendu par l'appelant est resté sans réponse du modèle : Léa a dit sa phrase de repli.
 * Compté une fois par tour, là où il échoue ; le juge et l'anticipation n'en font pas partie.
 */
export async function recordLlmBothProvidersFailed(
  cause: LlmTurnFailureCause,
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
      summary: `Le modèle vocal n'a pas répondu à ${failures} tours en 10 minutes : Léa a dit sa phrase de repli`,
      detail: [
        `failedTurns=${failures}`,
        `windowSeconds=${BOTH_DOWN_WINDOW_SECONDS}`,
        FAILURE_CAUSE_DETAIL[cause],
        'Action : vérifier la latence et le crédit Cerebras, l’état du secours OpenRouter et les journaux [llm-fallback].',
      ].join('\n'),
    },
    dependencies,
  );
}

/**
 * Le secours OpenRouter refuse les requêtes (crédit épuisé ou clé refusée), doublons compris :
 * quand Cerebras tarde, Léa n'a aucun relais. Avertissement, une fois par jour et par cause.
 */
export function alertLlmFallbackUnavailable(
  status: number,
  dependencies: LlmAlertDependencies = defaultDependencies,
): Promise<boolean> {
  const reason = status === 402 ? 'quota' : 'auth';
  return dispatchClaimed(
    `${KEY}:fallback:${reason}`,
    FALLBACK_COOLDOWN_SECONDS,
    {
      kind: 'voice_llm_fallback_unavailable',
      severity: 'warning',
      summary:
        reason === 'quota'
          ? 'Le secours OpenRouter refuse les requêtes (402, crédit épuisé) : Cerebras n’a plus de relais'
          : `Le secours OpenRouter refuse les requêtes (${status}, clé refusée) : Cerebras n’a plus de relais`,
      detail: [
        `status=${status}`,
        'Les appels continuent sur Cerebras seul : lors de ses pics de file, Léa répond lentement (jusqu’au délai total de 8 s).',
        reason === 'quota'
          ? 'Action : recharger OpenRouter si le secours doit revenir.'
          : 'Action : vérifier OPENROUTER_API_KEY si le secours doit revenir.',
      ].join('\n'),
    },
    dependencies,
  );
}

/** Une requête de doublon (hedging) est partie chez Cerebras : le premier texte a tardé. */
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
      summary: 'Cerebras est lent : le doublon est parti plusieurs fois en 15 minutes',
      detail: [
        `hedgeRequests=${fired}`,
        `windowSeconds=${HEDGE_WINDOW_SECONDS}`,
        'Chaque doublon coûte une requête de plus à Cerebras (même modèle) ; au-delà de ce rythme, la file de Cerebras est durablement lente.',
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
