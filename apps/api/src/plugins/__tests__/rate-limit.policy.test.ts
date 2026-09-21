/**
 * Rate-limit policy per surface (R0-2).
 *
 * The global limiter applies 100 req/min/IP to every route. These tests lock
 * the two deviations that matter in production:
 *
 * - provider webhooks must tolerate a burst above the global budget, otherwise
 *   a legitimate Telnyx or Stripe spike is answered with 429;
 * - unauthenticated token endpoints must be stricter than the global budget.
 *
 * Each test injects a distinct X-Forwarded-For so the in-memory store of
 * @fastify/rate-limit stays isolated between cases.
 */

import { afterAll, describe, expect, it } from 'vitest';
import type { InjectOptions } from 'fastify';
import { closeApp, getApp } from '../../test/helpers';
import {
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_PROVIDER_WEBHOOK,
  RATE_LIMIT_PUBLIC_TOKEN,
  RATE_LIMIT_PUBLIC_WRITE,
} from '../rate-limit.policy';

let ipCounter = 0;

function uniqueIp(): string {
  ipCounter += 1;
  return `198.51.100.${(ipCounter % 200) + 1}`;
}

async function injectTimes(
  url: string,
  count: number,
  options: { ip: string; method?: 'GET' | 'POST'; payload?: Record<string, unknown> },
): Promise<number[]> {
  const app = await getApp();
  const statuses: number[] = [];
  for (let index = 0; index < count; index++) {
    const injectOptions: InjectOptions = {
      method: options.method ?? 'POST',
      url,
      headers: { 'X-Forwarded-For': options.ip },
    };
    if (options.payload !== undefined) injectOptions.payload = options.payload;

    const response = await app.inject(injectOptions);
    statuses.push(response.statusCode);
  }
  return statuses;
}

describe('rate-limit policy', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('les paliers sont ordonnés : webhooks > global > token > écriture publique', () => {
    expect(RATE_LIMIT_PROVIDER_WEBHOOK.max).toBeGreaterThan(RATE_LIMIT_GLOBAL_MAX);
    expect(RATE_LIMIT_PUBLIC_TOKEN.max).toBeLessThan(RATE_LIMIT_GLOBAL_MAX);
    expect(RATE_LIMIT_PUBLIC_WRITE.max).toBeLessThan(RATE_LIMIT_PUBLIC_TOKEN.max);
  });

  it('le global 100 req/min s’applique à une route ordinaire', async () => {
    const statuses = await injectTimes('/livez', RATE_LIMIT_GLOBAL_MAX + 1, {
      ip: uniqueIp(),
      method: 'GET',
    });

    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('un webhook Telnyx encaisse un burst au-delà du global sans 429', async () => {
    const burst = RATE_LIMIT_GLOBAL_MAX + 50;
    const statuses = await injectTimes('/voice/telnyx', burst, { ip: uniqueIp() });

    // Sans signature, le guard répond 403 — mais jamais 429.
    expect(statuses).not.toContain(429);
    expect(new Set(statuses)).toEqual(new Set([403]));
  });

  it('un webhook Stripe encaisse un burst au-delà du global sans 429', async () => {
    const burst = RATE_LIMIT_GLOBAL_MAX + 10;
    const statuses = await injectTimes('/webhooks/stripe', burst, {
      ip: uniqueIp(),
      payload: {},
    });

    expect(statuses).not.toContain(429);
  });

  it('un endpoint public à token est plus strict que le global', async () => {
    const statuses = await injectTimes('/marketing/unsubscribe', RATE_LIMIT_PUBLIC_TOKEN.max + 1, {
      ip: uniqueIp(),
      payload: { token: 'x'.repeat(40) },
    });

    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });

  it('une écriture publique est encore plus stricte', async () => {
    const statuses = await injectTimes(
      '/reputation/feedback/submit',
      RATE_LIMIT_PUBLIC_WRITE.max + 1,
      { ip: uniqueIp(), payload: {} },
    );

    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(statuses[statuses.length - 1]).toBe(429);
  });
});
