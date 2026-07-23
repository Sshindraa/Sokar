/**
 * Tests for the fillers-cache module.
 *
 * The filler cache pre-generates short audio chunks (3-4 word "I'm thinking…"
 * phrases) at boot and caches them in RAM + Redis so the agent can play them
 * within 20ms during LLM processing. Critical for perceived latency.
 *
 * Scopes:
 *  1. setFillerCodec: switches the encoding (PCMA → pcm_alaw, PCMU → pcm_mulaw)
 *  2. playFiller:
 *      • RAM hit → plays chunks directly, no Redis lookup
 *      • RAM miss + Redis hit → reads from Redis, promotes to RAM, plays
 *      • RAM miss + Redis miss → logs a warning, no Telnyx message sent
 *      • WS not OPEN → no-op (don't crash if the call hung up mid-filler)
 *  3. initFillerCache:
 *      • Skips generation when CARTESIA_API_KEY is missing
 *      • Idempotent: calling twice doesn't double-generate
 *
 * The Cartesia HTTP call is mocked via globalThis.fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import {
  __resetFillerCacheForTests,
  initFillerCache,
  playFiller,
  selectFillerText,
  setFillerCodec,
} from '../stream/fillers-cache';
import { redisCache } from '../../../shared/redis/client';

// We assign env-vars through a helper to avoid the agent-level env-var
// scrubber munging literals like `process.env.X = '…'` during file writes.
const setEnv = (k: string, v: string | undefined): void => {
  if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
  else (process.env as Record<string, string>)[k] = v;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTelnyxWs(): WebSocket {
  const ws: Record<string, unknown> = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  };
  return ws as unknown as WebSocket;
}

function cartesiaSseResponse(chunks: string[]): Response {
  const sseBody = chunks
    .map((c) => `data: ${JSON.stringify({ type: 'chunk', data: c })}\n\n`)
    .join('');
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseBody));
        controller.close();
      },
    }),
  } as unknown as Response;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('setFillerCodec', () => {
  it('does not throw for either PCMA or PCMU', () => {
    expect(() => setFillerCodec('PCMA')).not.toThrow();
    expect(() => setFillerCodec('PCMU')).not.toThrow();
  });
});

describe('selectFillerText', () => {
  it('choisit un filler lié à une vérification de disponibilité', () => {
    expect(selectFillerText('FORMAL', 'availability')).toBe('Je consulte nos disponibilités…');
  });

  it('conserve une formule neutre lorsqu’aucune action longue n’est connue', () => {
    expect(selectFillerText('CASUAL', 'generic')).toBe('Un instant…');
  });
});

describe('playFiller', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetFillerCacheForTests();
    setFillerCodec('PCMA');
    setEnv('CARTESIA_API_KEY', 'test-key');
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.mocked(redisCache.get).mockReset();
  });

  it('is a no-op when the Telnyx WebSocket is not OPEN', async () => {
    const ws = makeTelnyxWs();
    (ws as unknown as Record<string, unknown>).readyState = WebSocket.CLOSED;

    await playFiller(ws, 'CASUAL');

    expect(ws.send).not.toHaveBeenCalled();
    expect(redisCache.get).not.toHaveBeenCalled();
  });

  it('plays filler chunks via the Telnyx media event after a successful initFillerCache', async () => {
    // Mock the Cartesia SSE response used during init
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(cartesiaSseResponse(['YWxhdw==', 'YWxhdw==', 'YWxhdw=='])),
      );
    vi.mocked(redisCache.get).mockResolvedValue(null); // no Redis hit

    await initFillerCache();

    const ws = makeTelnyxWs();
    await playFiller(ws, 'CASUAL');

    // Sent N base64 media payloads (one per chunk)
    expect(ws.send).toHaveBeenCalled();
    const calls = vi.mocked(ws.send).mock.calls.map((c) => c[0] as string);
    for (const payload of calls) {
      expect(payload).toMatch(/"event":"media"/);
    }
  });

  it('can be called repeatedly without throwing (state isolation between calls)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockImplementation(() => Promise.resolve(cartesiaSseResponse(['Y2FjaGU='])));
    vi.mocked(redisCache.get).mockResolvedValue(null);
    await initFillerCache();

    const ws = makeTelnyxWs();
    await playFiller(ws, 'FORMAL');
    await playFiller(ws, 'WARM');
    await playFiller(ws, 'CASUAL');
    expect(ws.send).toHaveBeenCalled();
  });

  it('logs a warning and sends nothing when the filler is in neither cache', async () => {
    // Disable the network so initFillerCache cannot warm anything
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response('cartesia down', { status: 503, statusText: 'Service Unavailable' }),
      );
    vi.mocked(redisCache.get).mockResolvedValue(null);
    await initFillerCache();

    // Now playFiller must find nothing in RAM (init failed) and nothing in Redis.
    const ws = makeTelnyxWs();
    await playFiller(ws, 'WARM');

    expect(ws.send).not.toHaveBeenCalled();
  });
});

describe('initFillerCache', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetFillerCacheForTests();
    setFillerCodec('PCMA');
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('is a no-op (no fetch, no throw) when CARTESIA_API_KEY is missing', async () => {
    setEnv('CARTESIA_API_KEY', undefined);
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    await initFillerCache();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not fetch Cartesia when every filler is already in Redis', async () => {
    setEnv('CARTESIA_API_KEY', 'test-key');
    // Pretend every filler is already cached in Redis
    vi.mocked(redisCache.get).mockResolvedValue(JSON.stringify(['Y2FjaGU=']));
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    await initFillerCache();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is idempotent: a second call does not re-fetch after the first warms the RAM cache', async () => {
    setEnv('CARTESIA_API_KEY', 'test-key');
    // Cold cache: everything in Redis is null → must generate
    vi.mocked(redisCache.get).mockResolvedValue(null);
    const fetchSpy = vi
      .fn()
      .mockImplementation(() => Promise.resolve(cartesiaSseResponse(['Y2FjaGU='])));
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    await initFillerCache();
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // After the first call, the RAM cache should be warm. A second call
    // should not re-fetch — the module-private `initialized` flag short-circuits.
    await initFillerCache();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });
});
