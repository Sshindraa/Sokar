import { Worker } from 'bullmq';
import { redisCache, redisQueue } from '../../redis/client';
import { elevenLabsCharacterCount, elevenLabsCharacterLimit } from '../../observability/metrics';
import { logger } from '../../logger/pino';
import { dispatchAlert } from '../../observability/alert-dispatcher';
import { currentMonthKey } from '../../../modules/usage/usage.service';
import { setupWorkerListeners } from './helper';

const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';
const REQUEST_TIMEOUT_MS = 10_000;

export interface ElevenLabsSubscription {
  character_count: number;
  character_limit: number;
  next_character_count_reset_unix?: number | null;
}

const CHARACTER_USAGE_THRESHOLDS = [
  { percentage: 80, severity: 'warning' },
  { percentage: 95, severity: 'critical' },
  { percentage: 100, severity: 'critical' },
] as const;
const FALLBACK_PERIOD_TTL_SECONDS = 45 * 24 * 60 * 60;
const PERIOD_RESET_GRACE_SECONDS = 24 * 60 * 60;

export interface ElevenLabsUsageAlertDependencies {
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
  readonly now: Date;
}

function subscriptionPeriod(
  subscription: ElevenLabsSubscription,
  now: Date,
): {
  key: string;
  ttlSeconds: number;
} {
  const resetAt = subscription.next_character_count_reset_unix;
  if (typeof resetAt === 'number' && Number.isFinite(resetAt) && resetAt * 1_000 > now.getTime()) {
    return {
      key: String(Math.floor(resetAt)),
      ttlSeconds: Math.ceil((resetAt * 1_000 - now.getTime()) / 1_000) + PERIOD_RESET_GRACE_SECONDS,
    };
  }
  return { key: currentMonthKey(now), ttlSeconds: FALLBACK_PERIOD_TTL_SECONDS };
}

/** Dispatch crossed ElevenLabs thresholds once while usage stays above them. */
export async function dispatchElevenLabsUsageAlerts(
  subscription: ElevenLabsSubscription,
  dependencies: ElevenLabsUsageAlertDependencies = {
    claimStore: redisCache,
    dispatch: dispatchAlert,
    now: new Date(),
  },
): Promise<{ dispatched: number; suppressed: number }> {
  const percentage = (subscription.character_count / subscription.character_limit) * 100;
  const period = subscriptionPeriod(subscription, dependencies.now);
  let dispatched = 0;
  let suppressed = 0;

  for (const threshold of CHARACTER_USAGE_THRESHOLDS) {
    const key = `sokar:elevenlabs:character-usage:${period.key}:${threshold.percentage}`;
    if (percentage < threshold.percentage) {
      try {
        await dependencies.claimStore.del(key);
      } catch (error) {
        logger.warn(
          { err: error, threshold: threshold.percentage },
          '[elevenlabs-subscription] Could not reset threshold latch',
        );
      }
      continue;
    }

    let claimed = false;
    try {
      claimed =
        (await dependencies.claimStore.set(key, '1', 'EX', period.ttlSeconds, 'NX')) === 'OK';
    } catch (error) {
      // Fail closed so a Redis outage cannot send the same alert every hour.
      logger.warn(
        { err: error, threshold: threshold.percentage },
        '[elevenlabs-subscription] Could not claim threshold alert',
      );
    }
    if (!claimed) {
      suppressed++;
      continue;
    }

    await dependencies.dispatch({
      kind: `elevenlabs_character_usage_${threshold.percentage}`,
      severity: threshold.severity,
      summary: `Consommation ElevenLabs à ${threshold.percentage} %`,
      detail: [
        `usage=${subscription.character_count}/${subscription.character_limit} caractères`,
        `percentage=${percentage.toFixed(1)}%`,
        `billingPeriod=${period.key}`,
      ].join('\n'),
    });
    dispatched++;
  }

  return { dispatched, suppressed };
}

export type SubscriptionFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export async function refreshElevenLabsSubscription(
  options: {
    apiKey?: string;
    fetcher?: SubscriptionFetch;
  } = {},
): Promise<ElevenLabsSubscription> {
  const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
  if (!apiKey?.trim()) throw new Error('ELEVENLABS_API_KEY is not configured');
  const fetcher: SubscriptionFetch = options.fetcher ?? fetch;
  const response = await fetcher(SUBSCRIPTION_URL, {
    method: 'GET',
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error('ElevenLabs subscription request failed with HTTP ' + response.status);
  }

  const payload = (await response.json()) as Partial<ElevenLabsSubscription>;
  if (
    !Number.isFinite(payload.character_count) ||
    !Number.isFinite(payload.character_limit) ||
    (payload.character_count as number) < 0 ||
    (payload.character_limit as number) <= 0 ||
    (payload.next_character_count_reset_unix !== undefined &&
      payload.next_character_count_reset_unix !== null &&
      (!Number.isFinite(payload.next_character_count_reset_unix) ||
        payload.next_character_count_reset_unix <= 0))
  ) {
    throw new Error('ElevenLabs subscription response has invalid character counts');
  }

  const subscription = {
    character_count: payload.character_count as number,
    character_limit: payload.character_limit as number,
    ...(payload.next_character_count_reset_unix !== undefined
      ? { next_character_count_reset_unix: payload.next_character_count_reset_unix }
      : {}),
  };
  elevenLabsCharacterCount.set(subscription.character_count);
  elevenLabsCharacterLimit.set(subscription.character_limit);
  return subscription;
}

export const elevenLabsSubscriptionWorker = new Worker(
  'elevenlabs-subscription',
  async () => {
    const subscription = await refreshElevenLabsSubscription();
    const alerts = await dispatchElevenLabsUsageAlerts(subscription);
    logger.info(
      {
        characterCount: subscription.character_count,
        characterLimit: subscription.character_limit,
        ...alerts,
      },
      '[elevenlabs-subscription] Usage metrics refreshed',
    );
  },
  { connection: redisQueue },
);

setupWorkerListeners(elevenLabsSubscriptionWorker);
