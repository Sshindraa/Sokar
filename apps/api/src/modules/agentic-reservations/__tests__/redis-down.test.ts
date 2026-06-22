/**
 * Tests Redis down : simule un cache Redis indisponible et vérifie
 * que l'idempotence fonctionne uniquement via Postgres.
 *
 * Stratégie : on injecte un faux IdempotencyCache qui jette systématiquement.
 * Le service ne doit pas planter et doit retomber sur Postgres.
 */

import { describe, expect, it } from 'vitest';
import {
  IdempotencyCache,
  IdempotencyService,
  type IdempotencyStore,
  computeIdempotencyScope,
  hashPayload,
} from '../core/idempotency.service.js';

function makeStore(): IdempotencyStore & {
  delete(scope: string, key: string): void;
} {
  const records = new Map<
    string,
    {
      payloadHash: string;
      reservationId: string | null;
      status: 'pending' | 'completed' | 'failed';
      expiresAt: Date;
    }
  >();

  return {
    delete(scope, key) {
      records.delete(`${scope}::${key}`);
    },
    async get(scope, key) {
      return records.get(`${scope}::${key}`) ?? null;
    },
    async insertPending({ scope, key, payloadHash, expiresAt }) {
      const recordKey = `${scope}::${key}`;
      if (records.has(recordKey)) {
        const err = new Error('unique violation') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      records.set(recordKey, {
        payloadHash,
        reservationId: null,
        status: 'pending',
        expiresAt,
      });
    },
    async markCompleted({ scope, key, reservationId }) {
      const recordKey = `${scope}::${key}`;
      const existing = records.get(recordKey);
      if (!existing) throw new Error('not found');
      records.set(recordKey, {
        ...existing,
        reservationId,
        status: 'completed',
      });
    },
    async markFailed({ scope, key }) {
      const recordKey = `${scope}::${key}`;
      const existing = records.get(recordKey);
      if (!existing) return;
      records.set(recordKey, { ...existing, status: 'failed' });
    },
    async purgeExpired() {
      const now = Date.now();
      let count = 0;
      for (const [key, value] of records.entries()) {
        if (value.expiresAt.getTime() < now) {
          records.delete(key);
          count++;
        }
      }
      return count;
    },
  };
}

class FailingCache implements IdempotencyCache {
  getCalls = 0;
  setCalls = 0;
  async get(): Promise<{ reservationId: string; payloadHash: string } | null> {
    this.getCalls++;
    throw new Error('Redis connection refused (simulated)');
  }
  async set(): Promise<void> {
    this.setCalls++;
    throw new Error('Redis connection refused (simulated)');
  }
}

describe('idempotency — Redis down fallback', () => {
  it('lookup fonctionne même si le cache Redis jette', async () => {
    const store = makeStore();
    const cache = new FailingCache();
    const service = new IdempotencyService(store, cache);

    const scope = computeIdempotencyScope({
      restaurantId: 'resto-test-redis-down',
      channel: 'MCP',
      clientId: 'redis-down-test',
    });
    const key = 'redis-down-key';
    const payloadHash = hashPayload({ a: 1 });

    store.delete(scope, key);

    // Premier passage : reserve + complete
    const r1 = await service.reserve({ scope, key, payloadHash, ttlSeconds: 60 });
    expect(r1).toBe('reserved');
    await service.complete({ scope, key, payloadHash, reservationId: 'r-1' });

    // Le cache a dû être appelé en set (et jeter, silencieusement avalé par try/catch)
    // Le lookup doit passer par Postgres et renvoyer hit
    const lookup = await service.lookup(scope, key, payloadHash);
    expect(lookup.kind).toBe('hit');
    if (lookup.kind === 'hit') {
      expect(lookup.reservationId).toBe('r-1');
    }
  });

  it('reserve + complete fonctionnent même si Redis down', async () => {
    const store = makeStore();
    const cache = new FailingCache();
    const service = new IdempotencyService(store, cache);

    const scope = computeIdempotencyScope({
      restaurantId: 'resto-test-redis-down',
      channel: 'MCP',
      clientId: 'redis-down-test-2',
    });
    const key = 'redis-down-key-2';
    const payloadHash = hashPayload({ b: 2 });

    store.delete(scope, key);

    const r = await service.reserve({ scope, key, payloadHash, ttlSeconds: 60 });
    expect(r).toBe('reserved');
    await service.complete({ scope, key, payloadHash, reservationId: 'r-2' });

    store.delete(scope, key);
  });
});
