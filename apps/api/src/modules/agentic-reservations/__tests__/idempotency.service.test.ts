import { describe, expect, it } from 'vitest';
import {
  computeIdempotencyScope,
  hashPayload,
  IdempotencyConflictError,
  IdempotencyService,
  type IdempotencyStore,
} from '../core/idempotency.service.js';

function makeStore(
  initial: Map<
    string,
    {
      payloadHash: string;
      reservationId: string | null;
      status: 'pending' | 'completed' | 'failed';
      expiresAt: Date;
    }
  > = new Map(),
): IdempotencyStore & { _internal: typeof initial } {
  const store: IdempotencyStore & { _internal: typeof initial } = {
    _internal: initial,
    async get(scope, key) {
      return initial.get(`${scope}::${key}`) ?? null;
    },
    async insertPending({ scope, key, payloadHash, expiresAt }) {
      const mapKey = `${scope}::${key}`;
      if (initial.has(mapKey)) {
        const err = new Error('unique violation') as Error & { code: string };
        err.code = 'P2002';
        throw err;
      }
      initial.set(mapKey, { payloadHash, reservationId: null, status: 'pending', expiresAt });
    },
    async markCompleted({ scope, key, reservationId, responseHash: _responseHash }) {
      const mapKey = `${scope}::${key}`;
      const existing = initial.get(mapKey);
      if (!existing) throw new Error('not found');
      initial.set(mapKey, {
        payloadHash: existing.payloadHash,
        reservationId,
        status: 'completed',
        expiresAt: existing.expiresAt,
      });
    },
    async markFailed({ scope, key }) {
      const mapKey = `${scope}::${key}`;
      const existing = initial.get(mapKey);
      if (!existing) return;
      initial.set(mapKey, { ...existing, status: 'failed' });
    },
    async purgeExpired() {
      const now = Date.now();
      let count = 0;
      for (const [k, v] of initial.entries()) {
        if (v.expiresAt.getTime() < now) {
          initial.delete(k);
          count++;
        }
      }
      return count;
    },
  };
  return store;
}

describe('idempotency.service', () => {
  describe('computeIdempotencyScope', () => {
    it('inclut restaurantId, channel et clientId', () => {
      const scope = computeIdempotencyScope({
        restaurantId: 'r-123',
        channel: 'MCP',
        clientId: 'cursor',
      });
      expect(scope).toBe('v1:restaurant:r-123:channel:MCP:client:cursor');
    });

    it('utilise "unknown" si clientId absent', () => {
      const scope = computeIdempotencyScope({
        restaurantId: 'r-123',
        channel: 'MCP',
      });
      expect(scope).toContain(':client:unknown');
    });

    it('utilise "unknown" si clientId vide', () => {
      const scope = computeIdempotencyScope({
        restaurantId: 'r-123',
        channel: 'API',
        clientId: '',
      });
      expect(scope).toContain(':client:unknown');
    });

    it('différentes scopes pour différents clients sur même resto/channel', () => {
      const a = computeIdempotencyScope({ restaurantId: 'r', channel: 'MCP', clientId: 'a' });
      const b = computeIdempotencyScope({ restaurantId: 'r', channel: 'MCP', clientId: 'b' });
      expect(a).not.toBe(b);
    });

    it('même scope si clientId identique', () => {
      const a = computeIdempotencyScope({ restaurantId: 'r', channel: 'MCP', clientId: 'x' });
      const b = computeIdempotencyScope({ restaurantId: 'r', channel: 'MCP', clientId: 'x' });
      expect(a).toBe(b);
    });
  });

  describe('hashPayload', () => {
    it('produit un hash sha256 hex 64 chars', () => {
      const h = hashPayload({ a: 1 });
      expect(h).toMatch(/^[a-f0-9]{64}$/);
    });

    it("est déterministe quel que soit l'ordre des clés", () => {
      const a = hashPayload({ a: 1, b: 2, c: 3 });
      const b = hashPayload({ c: 3, a: 1, b: 2 });
      expect(a).toBe(b);
    });

    it('produit des hashs différents pour payloads différents', () => {
      const a = hashPayload({ partySize: 2 });
      const b = hashPayload({ partySize: 3 });
      expect(a).not.toBe(b);
    });

    it('gère les arrays imbriquées', () => {
      const a = hashPayload({ tags: ['b', 'a', 'c'] });
      const b = hashPayload({ tags: ['b', 'a', 'c'] });
      expect(a).toBe(b);
    });

    it('convertit les Date en ISO string', () => {
      const d = '2026-06-21T12:00:00.000Z';
      const a = hashPayload({ at: new Date(d) });
      const b = hashPayload({ at: d });
      expect(a).toBe(b);
    });

    it('ignore les clés avec valeur undefined', () => {
      const a = hashPayload({ a: 1, b: undefined });
      const b = hashPayload({ a: 1 });
      expect(a).toBe(b);
    });

    it('rejette les nombres non finis', () => {
      expect(() => hashPayload({ x: Number.NaN })).toThrow();
      expect(() => hashPayload({ x: Infinity })).toThrow();
    });
  });

  describe('IdempotencyService.lookup', () => {
    it('retourne miss si pas de record', async () => {
      const store = makeStore();
      const svc = new IdempotencyService(store);
      const result = await svc.lookup('s', 'k', 'h');
      expect(result.kind).toBe('miss');
    });

    it('retourne hit si record completed avec même hash', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h',
        reservationId: 'r-1',
        status: 'completed' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const svc = new IdempotencyService(makeStore(map));
      const result = await svc.lookup('s', 'k', 'h');
      expect(result.kind).toBe('hit');
      if (result.kind === 'hit') {
        expect(result.reservationId).toBe('r-1');
      }
    });

    it('retourne conflict si hash différent', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h1',
        reservationId: 'r-1',
        status: 'completed' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const svc = new IdempotencyService(makeStore(map));
      const result = await svc.lookup('s', 'k', 'h2');
      expect(result.kind).toBe('conflict');
    });

    it('retourne miss si record pending sans reservationId', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h',
        reservationId: null,
        status: 'pending' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const svc = new IdempotencyService(makeStore(map));
      const result = await svc.lookup('s', 'k', 'h');
      expect(result.kind).toBe('miss');
    });
  });

  describe('IdempotencyService.reserve', () => {
    it('insère un record pending et retourne "reserved"', async () => {
      const store = makeStore();
      const svc = new IdempotencyService(store);
      const r = await svc.reserve({
        scope: 's',
        key: 'k',
        payloadHash: 'h',
        ttlSeconds: 60,
      });
      expect(r).toBe('reserved');
      expect(store._internal.size).toBe(1);
    });

    it('retourne "reused" si même key + même hash + completed', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h',
        reservationId: 'r-1',
        status: 'completed' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const svc = new IdempotencyService(makeStore(map));
      const r = await svc.reserve({ scope: 's', key: 'k', payloadHash: 'h', ttlSeconds: 60 });
      expect(r).toBe('reused');
    });

    it('jette IdempotencyConflictError sur hash différent', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h1',
        reservationId: 'r-1',
        status: 'completed' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const svc = new IdempotencyService(makeStore(map));
      await expect(
        svc.reserve({ scope: 's', key: 'k', payloadHash: 'h2', ttlSeconds: 60 }),
      ).rejects.toThrow(IdempotencyConflictError);
    });
  });

  describe('IdempotencyService.complete', () => {
    it('met à jour pending → completed', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h',
        reservationId: null,
        status: 'pending' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const store = makeStore(map);
      const svc = new IdempotencyService(store);
      await svc.complete({ scope: 's', key: 'k', payloadHash: 'h', reservationId: 'r-new' });
      const r = store._internal.get('s::k');
      expect(r?.status).toBe('completed');
      expect(r?.reservationId).toBe('r-new');
    });
  });

  describe('IdempotencyService.fail', () => {
    it('passe pending → failed', async () => {
      const map = new Map();
      map.set('s::k', {
        payloadHash: 'h',
        reservationId: null,
        status: 'pending' as const,
        expiresAt: new Date(Date.now() + 60_000),
      });
      const store = makeStore(map);
      const svc = new IdempotencyService(store);
      await svc.fail({ scope: 's', key: 'k' });
      const r = store._internal.get('s::k');
      expect(r?.status).toBe('failed');
    });
  });

  describe('flow end-to-end', () => {
    it('2 appels avec même key + payload → 1 résa', async () => {
      const store = makeStore();
      const svc = new IdempotencyService(store);
      const payload = { partySize: 4, startsAt: '2026-06-22T19:00:00Z' };
      const hash = hashPayload(payload);

      // Premier appel
      const r1 = await svc.reserve({ scope: 's', key: 'k1', payloadHash: hash, ttlSeconds: 60 });
      expect(r1).toBe('reserved');
      await svc.complete({ scope: 's', key: 'k1', payloadHash: hash, reservationId: 'r-1' });

      // Deuxième appel : même key, même payload → hit
      const lookup = await svc.lookup('s', 'k1', hash);
      expect(lookup.kind).toBe('hit');
      if (lookup.kind === 'hit') {
        expect(lookup.reservationId).toBe('r-1');
      }

      // Troisième appel : même key, payload différent → conflict
      const otherPayload = { partySize: 6, startsAt: '2026-06-22T19:00:00Z' };
      const otherHash = hashPayload(otherPayload);
      const lookup2 = await svc.lookup('s', 'k1', otherHash);
      expect(lookup2.kind).toBe('conflict');
    });
  });
});
