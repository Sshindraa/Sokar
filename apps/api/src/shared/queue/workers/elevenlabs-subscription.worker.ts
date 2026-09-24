import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { elevenLabsCharacterCount, elevenLabsCharacterLimit } from '../../observability/metrics';
import { logger } from '../../logger/pino';
import { setupWorkerListeners } from './helper';

const SUBSCRIPTION_URL = 'https://api.elevenlabs.io/v1/user/subscription';
const REQUEST_TIMEOUT_MS = 10_000;

export interface ElevenLabsSubscription {
  character_count: number;
  character_limit: number;
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
    (payload.character_limit as number) <= 0
  ) {
    throw new Error('ElevenLabs subscription response has invalid character counts');
  }

  const subscription = {
    character_count: payload.character_count as number,
    character_limit: payload.character_limit as number,
  };
  elevenLabsCharacterCount.set(subscription.character_count);
  elevenLabsCharacterLimit.set(subscription.character_limit);
  return subscription;
}

export const elevenLabsSubscriptionWorker = new Worker(
  'elevenlabs-subscription',
  async () => {
    const subscription = await refreshElevenLabsSubscription();
    logger.info(
      {
        characterCount: subscription.character_count,
        characterLimit: subscription.character_limit,
      },
      '[elevenlabs-subscription] Usage metrics refreshed',
    );
  },
  { connection: redisQueue },
);

setupWorkerListeners(elevenLabsSubscriptionWorker);
