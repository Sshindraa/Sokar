/**
 * Tests for the health check module.
 *
 * Strategy: each check (db, redis, queues, telnyx, deepgram, cartesia) is
 * mocked at the module boundary so we can drive success/failure/timeout
 * scenarios deterministically. We don't hit real providers in unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';

// ─── Mock the dependencies ────────────────────────────────────────────────
//
// We mock the *clients* the health module imports, not the health module
// itself. This means if a check starts importing a new client, the test
// file will fail at import time and force us to add a mock.

vi.mock('../../../src/shared/db/client', () => ({
  db: {
    $queryRaw: vi.fn().mockResolvedValue([{ '1': 1 }]),
  },
}));

vi.mock('../../../src/shared/redis/client', () => ({
  redisCache: {
    ping: vi.fn().mockResolvedValue('PONG'),
  },
  redisSession: {},
  redisQueue: {},
}));

vi.mock('../../../src/shared/queue/queues', () => ({
  queues: {
    analytics: { getJobCounts: vi.fn().mockResolvedValue({}) },
    eveningReport: { getJobCounts: vi.fn().mockResolvedValue({}) },
    onboarding: { getJobCounts: vi.fn().mockResolvedValue({}) },
    smsManager: { getJobCounts: vi.fn().mockResolvedValue({}) },
    smsClient: { getJobCounts: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('../../../src/shared/telnyx/client', () => ({
  default: {
    balance: {
      retrieve: vi.fn().mockResolvedValue({ balance: '100.00', currency: 'USD' }),
    },
  },
}));

const originalFetch = globalThis.fetch;
const originalEnv = {
  TELNYX_API_KEY: process.env.TELNYX_API_KEY,
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  CARTESIA_API_KEY: process.env.CARTESIA_API_KEY,
};

beforeAll(() => {
  // Make sure the voice provider env vars are set for all tests except
  // the "env not configured" suite (which unsets them explicitly).
  process.env.TELNYX_API_KEY = process.env.TELNYX_API_KEY ?? 'test-telnyx-key';
  process.env.DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY ?? 'test-deepgram-key';
  process.env.CARTESIA_API_KEY = process.env.CARTESIA_API_KEY ?? 'test-cartesia-key';
});

afterAll(() => {
  // Restore env to the original (test runner-level) values.
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

import { checkHealth } from '../../../src/shared/health/checks';
import { db } from '../../../src/shared/db/client';
import { redisCache } from '../../../src/shared/redis/client';
import { queues } from '../../../src/shared/queue/queues';
import telnyx from '../../../src/shared/telnyx/client';

const mockDb = db as unknown as { $queryRaw: ReturnType<typeof vi.fn> };
const mockRedis = redisCache as unknown as { ping: ReturnType<typeof vi.fn> };
const mockTelnyxBalance = (telnyx as unknown as { balance: { retrieve: ReturnType<typeof vi.fn> } })
  .balance;

beforeEach(() => {
  // Reset all mocks to a passing baseline before each test.
  vi.clearAllMocks();
  mockDb.$queryRaw.mockResolvedValue([{ '1': 1 }]);
  mockRedis.ping.mockResolvedValue('PONG');
  for (const q of Object.values(queues)) {
    (q as unknown as { getJobCounts: ReturnType<typeof vi.fn> }).getJobCounts.mockResolvedValue({});
  }
  mockTelnyxBalance.retrieve.mockResolvedValue({ balance: '100.00' });

  // Default fetch mock: 200 OK for both Deepgram and Cartesia.
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
  } as Response);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Defensive: if a test unset env vars, restore them now.
  process.env.TELNYX_API_KEY = originalEnv.TELNYX_API_KEY;
  process.env.DEEPGRAM_API_KEY = originalEnv.DEEPGRAM_API_KEY;
  process.env.CARTESIA_API_KEY = originalEnv.CARTESIA_API_KEY;
});

describe('checkHealth — happy path', () => {
  it('returns ok when all 6 checks pass', async () => {
    const result = await checkHealth();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(result.checks)).toEqual(
      expect.arrayContaining(['db', 'redis', 'queues', 'telnyx', 'deepgram', 'cartesia']),
    );
    for (const name of Object.keys(result.checks)) {
      expect(result.checks[name].status).toBe('ok');
      expect(typeof result.checks[name].latency_ms).toBe('number');
      expect(result.checks[name].latency_ms).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('checkHealth — core failure (503)', () => {
  it('returns degraded when db is down', async () => {
    mockDb.$queryRaw.mockRejectedValue(new Error('connection refused'));
    const result = await checkHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.db.status).toBe('error');
    expect(result.checks.db.error).toContain('connection refused');
  });

  it('returns degraded when redis is down', async () => {
    mockRedis.ping.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await checkHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.redis.status).toBe('error');
  });

  it('returns degraded when all queues throw', async () => {
    for (const q of Object.values(queues)) {
      (q as unknown as { getJobCounts: ReturnType<typeof vi.fn> }).getJobCounts.mockRejectedValue(
        new Error('queue down'),
      );
    }
    const result = await checkHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.queues.status).toBe('error');
    expect(result.checks.queues.error).toMatch(/queue down/);
  });
});

describe('checkHealth — voice provider failure (degraded, core ok)', () => {
  it('returns degraded when telnyx is down (core still ok)', async () => {
    mockTelnyxBalance.retrieve.mockRejectedValue(new Error('telnyx 503'));
    const result = await checkHealth();
    expect(result.status).toBe('degraded');
    expect(result.checks.telnyx.status).toBe('error');
    // Core checks should still be ok
    expect(result.checks.db.status).toBe('ok');
    expect(result.checks.redis.status).toBe('ok');
    expect(result.checks.queues.status).toBe('ok');
  });

  it('returns degraded when deepgram returns non-ok', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('deepgram')) {
        return { ok: false, status: 401, statusText: 'Unauthorized' } as Response;
      }
      return { ok: true, status: 200, statusText: 'OK' } as Response;
    });
    const result = await checkHealth();
    expect(result.checks.deepgram.status).toBe('error');
    expect(result.checks.deepgram.error).toMatch(/401/);
  });

  it('returns degraded when cartesia returns non-ok', async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: unknown) => {
      if (typeof url === 'string' && url.includes('cartesia')) {
        return { ok: false, status: 429, statusText: 'Too Many Requests' } as Response;
      }
      return { ok: true, status: 200, statusText: 'OK' } as Response;
    });
    const result = await checkHealth();
    expect(result.checks.cartesia.status).toBe('error');
    expect(result.checks.cartesia.error).toMatch(/429/);
  });
});

describe('checkHealth — timeout', () => {
  it('times out a voice provider check that hangs longer than 2s', async () => {
    // Make deepgram hang forever — the timeout in checks.ts should fire.
    globalThis.fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>(() => {
          /* never resolves */
        }),
    );
    const result = await checkHealth();
    // The test takes ~2s because voice providers keep the short timeout.
    expect(result.checks.deepgram.status).toBe('error');
    expect(result.checks.deepgram.error).toMatch(/timeout/);
  }, 5000);

  it('allows a slow cold core DB check under 10s', async () => {
    mockDb.$queryRaw.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([{ '1': 1 }]), 6000)),
    );

    const result = await checkHealth();

    expect(result.checks.db.status).toBe('ok');
  }, 12000);
});

describe('checkHealth — env not configured', () => {
  it('reports error for voice provider when env var is missing', async () => {
    delete process.env.TELNYX_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.CARTESIA_API_KEY;

    const result = await checkHealth();
    expect(result.checks.telnyx.status).toBe('error');
    expect(result.checks.telnyx.error).toMatch(/TELNYX_API_KEY/);
    expect(result.checks.deepgram.status).toBe('error');
    expect(result.checks.deepgram.error).toMatch(/DEEPGRAM_API_KEY/);
    expect(result.checks.cartesia.status).toBe('error');
    expect(result.checks.cartesia.error).toMatch(/CARTESIA_API_KEY/);
  });
});

describe('checkHealth — parallelism', () => {
  it('runs checks in parallel (not sequential)', async () => {
    // Make every check take 200ms. If sequential, total would be ~1200ms.
    // If parallel, total should be ~200ms.
    //
    // The no-misused-promises lint trips on arrow functions that return
    // a Promise. We use named async functions (typed Promise<T>) instead
    // of inline `() => promise.then(...)` to satisfy the type checker.
    const slow = <T>(val: T): Promise<T> => new Promise((r) => setTimeout(() => r(val), 200));
    mockDb.$queryRaw.mockImplementation(() => slow([{ '1': 1 }]));
    mockRedis.ping.mockImplementation(() => slow('PONG'));
    for (const q of Object.values(queues)) {
      (q as unknown as { getJobCounts: ReturnType<typeof vi.fn> }).getJobCounts.mockImplementation(
        () => slow({}),
      );
    }
    mockTelnyxBalance.retrieve.mockImplementation(() => slow({}));
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() => slow({ ok: true, status: 200, statusText: 'OK' } as Response));

    const start = Date.now();
    const result = await checkHealth();
    const elapsed = Date.now() - start;

    expect(result.status).toBe('ok');
    // Parallel: should be ~200ms, definitely < 800ms (which would be 4×200ms sequential).
    // Allow some headroom for scheduling overhead.
    expect(elapsed).toBeLessThan(800);
  }, 5000);
});
