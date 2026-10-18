import Redis from 'ioredis';
import { redisCache } from '../redis/client';
import { NotificationProviderRefusedError } from '../queue/notification-idempotency';
import { withTimeout } from '../resilience';

const KEY = 'sokar:resend:request-spacing:v1';
const SPACING_MS = 150;
const MAX_WAIT_MS = 5_000;

// Atomic grants use Redis time to coordinate API and workers, not recipients or API keys.
export const RESEND_SLOT_SCRIPT = `
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local previous = tonumber(redis.call('GET', KEYS[1]) or '0')
local delay = previous + tonumber(ARGV[1]) - now
if delay > 0 then return delay end
redis.call('SET', KEYS[1], now, 'PX', ARGV[1])
return 0
`;

let sharedRedis: Redis | undefined;
let sharedConnection: Promise<void> | undefined;
async function coordinator(): Promise<Redis> {
  const url = process.env.RESEND_RATE_LIMIT_REDIS_URL;
  if (!url) return redisCache;
  if (!sharedRedis) {
    sharedRedis = new Redis(url, {
      lazyConnect: true,
      commandTimeout: 500,
      connectTimeout: 500,
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
    });
    sharedRedis.on('error', () => {
      /* Admission fails closed; never log a Redis credential. */
    });
    sharedConnection = sharedRedis.connect().catch(() => undefined);
  }
  // Concurrent first requests must all await the same connection attempt.
  await withTimeout(sharedConnection!, 500, 'resend.rate-limit.connect');
  return sharedRedis;
}

export async function waitForResendSlot(
  grant: () => Promise<unknown> = async () =>
    (await coordinator()).eval(RESEND_SLOT_SCRIPT, 1, KEY, SPACING_MS),
): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  try {
    while (Date.now() < deadline) {
      const delay = await withTimeout(grant(), 500, 'resend.rate-limit');
      if (typeof delay !== 'number' || !Number.isFinite(delay) || delay < 0) {
        throw new Error('Invalid rate-limit response');
      }
      if (Date.now() >= deadline) break;
      if (delay === 0) return;
      if (Date.now() + delay >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  } catch {
    // No provider call has started: existing durable jobs can retry safely.
    throw new NotificationProviderRefusedError('resend', 'email');
  }
  throw new NotificationProviderRefusedError('resend', 'email');
}
