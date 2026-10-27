import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// Simule la session Clerk résolue en onRequest : l'en-tête de test porte l'utilisateur.
vi.mock('@clerk/fastify', () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers['x-test-user'] ?? null,
  }),
}));

import { publicReadMax, registerRateLimit } from '../rate-limit';
import {
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_USER_READ_MAX,
  RATE_LIMIT_USER_WRITE_MAX,
} from '../rate-limit.policy';

async function hit(app: FastifyInstance, method: 'GET' | 'PATCH', n: number, user?: string) {
  const codes: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await app.inject({
      method,
      url: '/r',
      remoteAddress: '203.0.113.5',
      headers: user ? { 'x-test-user': user } : {},
    });
    codes.push(res.statusCode);
  }
  return codes;
}

describe('rate-limit global — budgets par utilisateur', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await registerRateLimit(app);
    app.get('/r', async () => ({ ok: true }));
    app.patch('/r', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('le polling de plusieurs postes ne bloque pas une action du personnel', async () => {
    // Quatre postes Salle derrière la même IP, même compte : 4 × 24 lectures + marge.
    const reads = await hit(app, 'GET', 150, 'user_salle');
    expect(reads.every((c) => c === 200)).toBe(true);

    const writes = await hit(app, 'PATCH', 5, 'user_salle');
    expect(writes.every((c) => c === 200)).toBe(true);
  });

  it('chaque budget authentifié reste fini', async () => {
    const writes = await hit(app, 'PATCH', RATE_LIMIT_USER_WRITE_MAX + 1, 'user_a');
    expect(writes.at(-1)).toBe(429);

    const reads = await hit(app, 'GET', RATE_LIMIT_USER_READ_MAX + 1, 'user_a');
    expect(reads.at(-2)).toBe(200);
    expect(reads.at(-1)).toBe(429);
  });

  it('deux utilisateurs derrière la même IP ont des compteurs distincts', async () => {
    await hit(app, 'PATCH', RATE_LIMIT_USER_WRITE_MAX, 'user_a');
    const other = await hit(app, 'PATCH', 1, 'user_b');
    expect(other).toEqual([200]);
  });

  it('le trafic anonyme garde le budget par IP', async () => {
    const codes = await hit(app, 'GET', RATE_LIMIT_GLOBAL_MAX + 1);
    expect(codes.at(-2)).toBe(200);
    expect(codes.at(-1)).toBe(429);
  });
});

describe('publicReadMax — rendu serveur de Connect', () => {
  it('le loopback a son budget, un visiteur garde le plafond public', async () => {
    const app = Fastify();
    await registerRateLimit(app);
    app.get('/public', { config: { rateLimit: { max: publicReadMax(2) } } }, async () => ({}));
    await app.ready();

    const call = (remoteAddress: string) =>
      app.inject({ method: 'GET', url: '/public', remoteAddress }).then((r) => r.statusCode);

    // 3 pages absentes du cache rendues par Connect : au-delà du plafond public de 2.
    expect([await call('127.0.0.1'), await call('127.0.0.1'), await call('127.0.0.1')]).toEqual([
      200, 200, 200,
    ]);
    expect([
      await call('198.51.100.9'),
      await call('198.51.100.9'),
      await call('198.51.100.9'),
    ]).toEqual([200, 200, 429]);
    await app.close();
  });
});
