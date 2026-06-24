/**
 * Tests for the Telnyx webhook signature guard.
 *
 * Telnyx signs every webhook with Ed25519 over (timestamp, rawBody) using a
 * public key we configure. A misconfigured guard is a security hole: an
 * attacker can hit /voice/telnyx and trigger our pipeline (call.initiated
 * → enqueue answer job, look up customer, etc.).
 *
 * We test 3 paths:
 *  1. Missing headers → 403
 *  2. Invalid signature (telnyx.webhooks.constructEvent throws) → 403
 *  3. Valid signature → guard resolves silently, no reply.send call
 *
 * Note: telnyx.webhooks.constructEvent is a dynamic import inside the guard
 * (lazy-loaded so test setup doesn't have to provide it eagerly). We mock
 * the `telnyx` module to control its behaviour.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the `telnyx` module so the dynamic import inside the guard resolves
// to our fake. We don't need to mock the default export shape precisely —
// the guard only uses `default.webhooks.constructEvent`.
const mockConstructEvent = vi.fn();
vi.mock('telnyx', () => ({
  default: {
    webhooks: {
      constructEvent: (...args: unknown[]) => mockConstructEvent(...args),
    },
  },
}));

import { telnyxWebhookGuard } from '../telnyx.guard';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeReq(
  overrides: Partial<{
    headers: Record<string, string | undefined>;
    rawBody: string | undefined;
    log: {
      info: ReturnType<typeof vi.fn>;
      warn: ReturnType<typeof vi.fn>;
      error: ReturnType<typeof vi.fn>;
    };
  }> = {},
) {
  return {
    headers: overrides.headers ?? {},
    rawBody: overrides.rawBody,
    log: overrides.log ?? {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  } as any;
}

function makeReply() {
  return {
    status: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as any;
}

// We need TELNYX_PUBLIC_KEY in env for the guard to read it.
const ORIGINAL_KEY = process.env.TELNYX_PUBLIC_KEY;
const setEnv = (k: string, v: string | undefined): void => {
  if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
  else (process.env as Record<string, string>)[k] = v;
};
const TEST_PUBLIC_KEY = 'MCowBQYDK2VwAyEAR8N1Yj7RvYzBvz3hP8o5iY3uLx9qAYE5CpFQb0ePzg=';

beforeEach(() => {
  mockConstructEvent.mockReset();
  // 32 bytes of base64 — a non-zero key. The guard only passes it to
  // constructEvent, so the value itself doesn't matter for our tests.
  if (!process.env.TELNYX_PUBLIC_KEY) setEnv('TELNYX_PUBLIC_KEY', TEST_PUBLIC_KEY);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe('telnyxWebhookGuard', () => {
  it('returns 403 when telnyx-signature-ed25519 header is missing', async () => {
    const req = makeReq({
      headers: { 'telnyx-timestamp': '1700000000' },
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it('returns 403 when telnyx-timestamp header is missing', async () => {
    const req = makeReq({
      headers: { 'telnyx-signature-ed25519': 'MCowBQYDK2VwAyE=' },
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
    expect(mockConstructEvent).not.toHaveBeenCalled();
  });

  it('returns 403 when both signature and timestamp are missing', async () => {
    const req = makeReq({ headers: {} });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('returns 403 when telnyx.webhooks.constructEvent throws (bad signature)', async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error('Signature verification failed');
    });

    const req = makeReq({
      headers: {
        'telnyx-signature-ed25519': 'MCowBQYDK2VwAyE=',
        'telnyx-timestamp': '1700000000',
      },
      rawBody: '{"data":{"event_type":"call.initiated"}}',
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('resolves silently when signature is valid (no reply.status or reply.send)', async () => {
    mockConstructEvent.mockReturnValue({ data: { event_type: 'call.initiated' } });

    const req = makeReq({
      headers: {
        'telnyx-signature-ed25519': 'MCowBQYDK2VwAyE=',
        'telnyx-timestamp': '1700000000',
      },
      rawBody: '{"data":{"event_type":"call.initiated"}}',
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(mockConstructEvent).toHaveBeenCalledTimes(1);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('passes the rawBody (not the parsed JSON) to constructEvent — key order matters for Ed25519', async () => {
    mockConstructEvent.mockReturnValue({ ok: true });

    const rawBody = '{"data":{"event_type":"call.hangup","payload":{"call_leg_id":"leg-1"}}}';
    const req = makeReq({
      headers: {
        'telnyx-signature-ed25519': 'MCowBQYDK2VwAyE=',
        'telnyx-timestamp': '1700000000',
      },
      rawBody,
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(mockConstructEvent).toHaveBeenCalledWith(
      rawBody,
      expect.any(Uint8Array), // decoded signature
      '1700000000',
      expect.any(Uint8Array), // decoded public key
    );
    // First arg is the raw body string — NOT a re-serialised JSON object.
    const firstArg = mockConstructEvent.mock.calls[0][0];
    expect(typeof firstArg).toBe('string');
    expect(firstArg).toBe(rawBody);
  });

  it('returns 403 when rawBody is missing (content-type parser not configured)', async () => {
    mockConstructEvent.mockReturnValue({ ok: true });

    const req = makeReq({
      headers: {
        'telnyx-signature-ed25519': 'MCowBQYDK2VwAyE=',
        'telnyx-timestamp': '1700000000',
      },
      rawBody: undefined,
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('decodes base64 signature and public key to Uint8Array before passing to constructEvent', async () => {
    mockConstructEvent.mockReturnValue({ ok: true });

    // Valid base64 — "SGVsbG8=" decodes to "Hello" (5 bytes).
    const signature = 'SGVsbG8=';
    const publicKey = 'SGVsbG8=';
    process.env.TELNYX_PUBLIC_KEY = publicKey;

    const req = makeReq({
      headers: {
        'telnyx-signature-ed25519': signature,
        'telnyx-timestamp': '1700000000',
      },
      rawBody: '{}',
    });
    const reply = makeReply();

    await telnyxWebhookGuard(req, reply);

    const [, sigArg, , pkArg] = mockConstructEvent.mock.calls[0];
    expect(sigArg).toBeInstanceOf(Uint8Array);
    expect(pkArg).toBeInstanceOf(Uint8Array);
    // "Hello" in bytes
    expect(Array.from(sigArg as Uint8Array)).toEqual([72, 101, 108, 108, 111]);
    expect(Array.from(pkArg as Uint8Array)).toEqual([72, 101, 108, 108, 111]);
  });
});
