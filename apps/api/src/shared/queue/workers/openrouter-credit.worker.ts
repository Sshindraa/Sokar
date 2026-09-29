import { Worker } from 'bullmq';
import { redisCache, redisQueue } from '../../redis/client';
import { openRouterCreditUsd } from '../../observability/metrics';
import { logger } from '../../logger/pino';
import { dispatchAlert } from '../../observability/alert-dispatcher';
import { setupWorkerListeners } from './helper';

const CREDITS_PATH = '/credits';
const REQUEST_TIMEOUT_MS = 10_000;
const LATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Le repli du modèle vocal, le juge automatique et le scoring Jev dépendent du crédit OpenRouter :
 * à zéro, le filet de sécurité disparaît sans que rien ne casse visiblement.
 */
export const OPENROUTER_CREDIT_LEVELS = [
  { name: 'low', thresholdUsd: 2, severity: 'warning' },
  { name: 'critical', thresholdUsd: 0.5, severity: 'critical' },
] as const;

export interface OpenRouterCreditDependencies {
  readonly claimStore: {
    set(
      key: string,
      value: string,
      expiryMode: 'EX',
      ttlSeconds: number,
      condition: 'NX',
    ): Promise<string | null>;
    del(key: string): Promise<number>;
  };
  readonly dispatch: typeof dispatchAlert;
}

/** Une alerte par niveau franchi ; le verrou se relâche quand le crédit remonte (recharge). */
export async function dispatchOpenRouterCreditAlerts(
  remainingUsd: number,
  dependencies: OpenRouterCreditDependencies = { claimStore: redisCache, dispatch: dispatchAlert },
): Promise<{ dispatched: number; suppressed: number }> {
  let dispatched = 0;
  let suppressed = 0;
  for (const level of OPENROUTER_CREDIT_LEVELS) {
    const key = `sokar:openrouter:credit:${level.name}`;
    if (remainingUsd >= level.thresholdUsd) {
      try {
        await dependencies.claimStore.del(key);
      } catch (error) {
        logger.warn({ err: error, level: level.name }, '[openrouter-credit] Could not reset latch');
      }
      continue;
    }
    let claimed = false;
    try {
      claimed =
        (await dependencies.claimStore.set(key, '1', 'EX', LATCH_TTL_SECONDS, 'NX')) === 'OK';
    } catch (error) {
      // Redis en panne : pas d'alerte plutôt qu'une alerte toutes les heures.
      logger.warn({ err: error, level: level.name }, '[openrouter-credit] Could not claim alert');
    }
    if (!claimed) {
      suppressed++;
      continue;
    }
    await dependencies.dispatch({
      kind: `openrouter_credit_${level.name}`,
      severity: level.severity,
      summary: `Crédit OpenRouter bas : ${remainingUsd.toFixed(2)} $ (seuil ${level.thresholdUsd} $)`,
      detail: [
        `remainingUsd=${remainingUsd.toFixed(2)}`,
        `thresholdUsd=${level.thresholdUsd}`,
        'Sans crédit : plus de repli du modèle vocal, plus de scoring Jev ni de juge automatique.',
        'Action : recharger le crédit OpenRouter (recharge automatique conseillée).',
      ].join('\n'),
    });
    dispatched++;
  }
  return { dispatched, suppressed };
}

export type CreditFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** Crédit restant en dollars, ou null si la clé est absente. Lève sur une réponse invalide. */
export async function fetchOpenRouterRemainingUsd(
  options: { apiKey?: string; baseUrl?: string; fetcher?: CreditFetch } = {},
): Promise<number | null> {
  const apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY)?.trim();
  if (!apiKey) return null;
  const baseUrl =
    options.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  const fetcher: CreditFetch = options.fetcher ?? fetch;
  const response = await fetcher(`${baseUrl}${CREDITS_PATH}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`OpenRouter credits request failed with HTTP ${response.status}`);
  const payload = (await response.json()) as {
    data?: { total_credits?: number; total_usage?: number };
  };
  const total = payload.data?.total_credits;
  const usage = payload.data?.total_usage;
  if (!Number.isFinite(total) || !Number.isFinite(usage)) {
    throw new Error('OpenRouter credits response is invalid');
  }
  return (total as number) - (usage as number);
}

export const openRouterCreditWorker = new Worker(
  'openrouter-credit',
  async () => {
    const remainingUsd = await fetchOpenRouterRemainingUsd();
    if (remainingUsd === null) return;
    openRouterCreditUsd.set(remainingUsd);
    const alerts = await dispatchOpenRouterCreditAlerts(remainingUsd);
    logger.info(
      { remainingUsd: Number(remainingUsd.toFixed(2)), ...alerts },
      '[openrouter-credit] Credit checked',
    );
  },
  { connection: redisQueue },
);

setupWorkerListeners(openRouterCreditWorker);
