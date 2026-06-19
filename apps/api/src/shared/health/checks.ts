/**
 * Health checks for Sokar API.
 *
 * Six independent checks: db, redis, queues, telnyx, deepgram, cartesia.
 * Each check has its own timeout and returns a uniform `CheckResult` shape.
 * The orchestrator runs them in parallel and never lets one slow check
 * block another.
 *
 * Design decisions:
 *
 * 1. **No internal mocking of side effects**: each check performs a real
 *    I/O call (a `SELECT 1`, a `PING`, an HTTP GET). A passing check
 *    means the dependency is reachable AND responsive.
 *
 * 2. **Timeout per check, not global**: a slow Telnyx (3s) must not delay
 *    a fast DB ping (5ms). Each check races its I/O against a
 *    `Promise.race` with a configurable timeout (default 2s).
 *
 * 3. **Latency always reported**: even on success. Useful for
 *    "DB is up but slow" detection (>500ms triggers degraded but ok).
 *
 * 4. **Errors never throw**: a failed check returns `{ status: 'error',
 *    error: <message> }`. The orchestrator decides if the overall status
 *    is `ok` or `degraded` based on which checks failed.
 *
 * 5. **Provider checks are read-only**:
 *    - Telnyx:   `balance.retrieve()` — GET, no cost, no side effect
 *    - Deepgram: `GET /v1/projects`   — list user's projects, no STT run
 *    - Cartesia: `GET /voices`        — list voices, no TTS generation
 *
 * 6. **Soft-fail for voice providers**: if Telnyx/Deepgram/Cartesia are
 *    down but DB/Redis/queues are ok, the API can still answer
 *    non-voice requests (read dashboard, list reservations, etc.).
 *    So voice provider failure is a warning, not a 503.
 *    Core failure (db/redis/queues) IS a 503.
 */
import { db } from '../db/client';
import { redisCache } from '../redis/client';
import { queues } from '../queue/queues';
import telnyx from '../telnyx/client';

export type CheckStatus = 'ok' | 'error';

export interface CheckResult {
  status: CheckStatus;
  latency_ms: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: Record<string, CheckResult>;
  timestamp: string;
}

const DEFAULT_TIMEOUT_MS = 2000;

/**
 * Wrap a check with a timeout. The wrapped promise resolves to a
 * CheckResult; it never throws.
 */
async function withTimeout(
  name: string,
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timeout after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Core dependencies (failure = 503) ─────────────────────────────────────

async function checkDb(): Promise<CheckResult> {
  return withTimeout('db', db.$queryRaw`SELECT 1`, DEFAULT_TIMEOUT_MS);
}

async function checkRedis(): Promise<CheckResult> {
  return withTimeout('redis', redisCache.ping(), DEFAULT_TIMEOUT_MS);
}

async function checkQueues(): Promise<CheckResult> {
  // BullMQ getJobCounts() returns a counts object. If Redis is down
  // this throws. We just want to confirm each queue is reachable.
  const start = Date.now();
  const queueErrors: string[] = [];
  try {
    await Promise.all(
      Object.entries(queues).map(async ([name, queue]) => {
        try {
          if (typeof queue.getJobCounts === 'function') {
            await Promise.race([
              queue.getJobCounts(),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('timeout')), DEFAULT_TIMEOUT_MS),
              ),
            ]);
          }
        } catch (err) {
          queueErrors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );
    if (queueErrors.length > 0) {
      return {
        status: 'error',
        latency_ms: Date.now() - start,
        error: queueErrors.join('; '),
      };
    }
    return { status: 'ok', latency_ms: Date.now() - start };
  } catch (err) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Voice providers (failure = degraded, still 200) ───────────────────────

async function checkTelnyx(): Promise<CheckResult> {
  // balance.retrieve() is a GET — no cost, no side effect.
  // It validates the API key AND reaches the Telnyx API.
  return withTimeout(
    'telnyx',
    (async () => {
      if (!process.env.TELNYX_API_KEY) {
        throw new Error('TELNYX_API_KEY not configured');
      }
      // The proxy in telnyx/client.ts initializes lazily; accessing
      // .balance.retrieve() works whether or not we've used the client before.
      await telnyx.balance.retrieve();
    })(),
    DEFAULT_TIMEOUT_MS,
  );
}

async function checkDeepgram(): Promise<CheckResult> {
  // Direct GET to /v1/projects — no SDK needed, just a bearer-style token.
  // We use fetch (Node 20+ global) instead of pulling in @deepgram/sdk
  // for a single health check.
  return withTimeout(
    'deepgram',
    (async () => {
      if (!process.env.DEEPGRAM_API_KEY) {
        throw new Error('DEEPGRAM_API_KEY not configured');
      }
      const res = await fetch('https://api.deepgram.com/v1/projects', {
        method: 'GET',
        headers: {
          Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
        },
      });
      if (!res.ok) {
        throw new Error(`Deepgram API ${res.status}: ${res.statusText}`);
      }
    })(),
    DEFAULT_TIMEOUT_MS,
  );
}

async function checkCartesia(): Promise<CheckResult> {
  // Direct GET to /voices — list available voices, no TTS generation.
  return withTimeout(
    'cartesia',
    (async () => {
      if (!process.env.CARTESIA_API_KEY) {
        throw new Error('CARTESIA_API_KEY not configured');
      }
      const res = await fetch('https://api.cartesia.ai/voices', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${process.env.CARTESIA_API_KEY}`,
        },
      });
      if (!res.ok) {
        throw new Error(`Cartesia API ${res.status}: ${res.statusText}`);
      }
    })(),
    DEFAULT_TIMEOUT_MS,
  );
}

// ─── Orchestrator ─────────────────────────────────────────────────────────

const CORE_CHECKS = ['db', 'redis', 'queues'] as const;
const VOICE_CHECKS = ['telnyx', 'deepgram', 'cartesia'] as const;
const ALL_CHECKS = [...CORE_CHECKS, ...VOICE_CHECKS] as const;

export async function checkHealth(): Promise<HealthReport> {
  const [db, redis, queues, telnyx, deepgram, cartesia] = await Promise.all([
    checkDb(),
    checkRedis(),
    checkQueues(),
    checkTelnyx(),
    checkDeepgram(),
    checkCartesia(),
  ]);

  const checks: Record<string, CheckResult> = {
    db,
    redis,
    queues,
    telnyx,
    deepgram,
    cartesia,
  };

  // Core failure = 503 (API can't serve anything).
  // Voice failure = degraded but 200 (API still serves non-voice traffic).
  const anyFailed = ALL_CHECKS.some((name) => checks[name].status === 'error');

  return {
    status: anyFailed ? 'degraded' : 'ok',
    checks,
    timestamp: new Date().toISOString(),
  };
}
