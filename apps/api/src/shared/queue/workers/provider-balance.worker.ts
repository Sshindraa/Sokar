import { Worker } from 'bullmq';
import { redisCache, redisQueue } from '../../redis/client';
import { logger } from '../../logger/pino';
import { dispatchAlert } from '../../observability/alert-dispatcher';
import { setupWorkerListeners } from './helper';

const REQUEST_TIMEOUT_MS = 10_000;
const LATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Solde Telnyx et quota de caractères ElevenLabs : à zéro, les appels s'arrêtent (plus de ligne ou
 * plus de voix) sans erreur visible côté application. Même mécanique que le crédit OpenRouter :
 * une alerte par niveau franchi, relâchée quand la valeur remonte.
 */
export const TELNYX_BALANCE_LEVELS = [
  { name: 'low', threshold: 20, severity: 'warning' },
  { name: 'critical', threshold: 5, severity: 'critical' },
] as const;

/** Part du quota mensuel ElevenLabs encore disponible. */
export const ELEVENLABS_QUOTA_LEVELS = [
  { name: 'low', threshold: 0.2, severity: 'warning' },
  { name: 'critical', threshold: 0.05, severity: 'critical' },
] as const;

type Level = { name: string; threshold: number; severity: 'warning' | 'critical' };

export interface ProviderBalanceDependencies {
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

const defaultDependencies: ProviderBalanceDependencies = {
  claimStore: redisCache,
  dispatch: dispatchAlert,
};

export async function dispatchLevelAlerts(
  args: {
    provider: 'telnyx' | 'elevenlabs';
    value: number;
    levels: readonly Level[];
    summary: (level: Level) => string;
    detail: string[];
  },
  dependencies: ProviderBalanceDependencies = defaultDependencies,
): Promise<{ dispatched: number; suppressed: number }> {
  let dispatched = 0;
  let suppressed = 0;
  for (const level of args.levels) {
    const key = `sokar:provider-balance:${args.provider}:${level.name}`;
    if (args.value >= level.threshold) {
      try {
        await dependencies.claimStore.del(key);
      } catch (error) {
        logger.warn(
          { err: error, provider: args.provider },
          '[provider-balance] Latch reset failed',
        );
      }
      continue;
    }
    let claimed = false;
    try {
      claimed =
        (await dependencies.claimStore.set(key, '1', 'EX', LATCH_TTL_SECONDS, 'NX')) === 'OK';
    } catch (error) {
      // Redis en panne : pas d'alerte plutôt qu'une alerte toutes les heures.
      logger.warn({ err: error, provider: args.provider }, '[provider-balance] Claim failed');
    }
    if (!claimed) {
      suppressed++;
      continue;
    }
    await dependencies.dispatch({
      kind: `${args.provider}_balance_${level.name}`,
      severity: level.severity,
      summary: args.summary(level),
      detail: args.detail.join('\n'),
    });
    dispatched++;
  }
  return { dispatched, suppressed };
}

export type BalanceFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

/** Crédit Telnyx disponible (solde + découvert autorisé), ou null sans clé. */
export async function fetchTelnyxAvailableCredit(
  options: { apiKey?: string; fetcher?: BalanceFetch } = {},
): Promise<{ available: number; currency: string } | null> {
  const apiKey = (options.apiKey ?? process.env.TELNYX_API_KEY)?.trim();
  if (!apiKey) return null;
  const fetcher: BalanceFetch = options.fetcher ?? fetch;
  const response = await fetcher('https://api.telnyx.com/v2/balance', {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Telnyx balance request failed with HTTP ${response.status}`);
  const payload = (await response.json()) as {
    data?: { available_credit?: string; currency?: string };
  };
  const available = Number(payload.data?.available_credit);
  if (!Number.isFinite(available)) throw new Error('Telnyx balance response is invalid');
  return { available, currency: payload.data?.currency ?? 'USD' };
}

/** Caractères ElevenLabs restants sur la période, ou null sans clé. */
export async function fetchElevenLabsQuota(
  options: { apiKey?: string; fetcher?: BalanceFetch } = {},
): Promise<{ used: number; limit: number; remainingRatio: number; tier: string } | null> {
  const apiKey = (options.apiKey ?? process.env.ELEVENLABS_API_KEY)?.trim();
  if (!apiKey) return null;
  const fetcher: BalanceFetch = options.fetcher ?? fetch;
  const response = await fetcher('https://api.elevenlabs.io/v1/user/subscription', {
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs subscription request failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as {
    character_count?: number;
    character_limit?: number;
    tier?: string;
  };
  const used = payload.character_count;
  const limit = payload.character_limit;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || (limit as number) <= 0) {
    throw new Error('ElevenLabs subscription response is invalid');
  }
  return {
    used: used as number,
    limit: limit as number,
    remainingRatio: Math.max(0, ((limit as number) - (used as number)) / (limit as number)),
    tier: payload.tier ?? 'unknown',
  };
}

export async function checkProviderBalances(
  dependencies: ProviderBalanceDependencies = defaultDependencies,
): Promise<void> {
  const telnyx = await fetchTelnyxAvailableCredit().catch((error: unknown) => {
    logger.warn({ err: error }, '[provider-balance] Telnyx balance unavailable');
    return null;
  });
  if (telnyx) {
    const alerts = await dispatchLevelAlerts(
      {
        provider: 'telnyx',
        value: telnyx.available,
        levels: TELNYX_BALANCE_LEVELS,
        summary: (level) =>
          `Solde Telnyx bas : ${telnyx.available.toFixed(2)} ${telnyx.currency} (seuil ${level.threshold})`,
        detail: [
          `available=${telnyx.available.toFixed(2)} ${telnyx.currency}`,
          'À zéro : plus d’appels entrants ni de SMS, les numéros peuvent être suspendus.',
          'Action : recharger Telnyx et activer la recharge automatique.',
        ],
      },
      dependencies,
    );
    logger.info({ available: telnyx.available, ...alerts }, '[provider-balance] Telnyx checked');
  }

  const elevenlabs = await fetchElevenLabsQuota().catch((error: unknown) => {
    logger.warn({ err: error }, '[provider-balance] ElevenLabs quota unavailable');
    return null;
  });
  if (elevenlabs) {
    const percent = Math.round(elevenlabs.remainingRatio * 100);
    const alerts = await dispatchLevelAlerts(
      {
        provider: 'elevenlabs',
        value: elevenlabs.remainingRatio,
        levels: ELEVENLABS_QUOTA_LEVELS,
        summary: (level) =>
          `Quota ElevenLabs bas : ${percent} % restant (seuil ${Math.round(level.threshold * 100)} %)`,
        detail: [
          `tier=${elevenlabs.tier} used=${elevenlabs.used} limit=${elevenlabs.limit}`,
          'À zéro : l’assistant vocal n’a plus de voix (le repli HTTP utilise le même compte).',
          'Action : passer à un forfait supérieur ou autoriser le dépassement.',
        ],
      },
      dependencies,
    );
    logger.info(
      { tier: elevenlabs.tier, remainingPercent: percent, ...alerts },
      '[provider-balance] ElevenLabs checked',
    );
  }
}

export const providerBalanceWorker = new Worker(
  'provider-balance',
  async () => {
    await checkProviderBalances();
  },
  { connection: redisQueue },
);

setupWorkerListeners(providerBalanceWorker);
