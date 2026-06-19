/**
 * Integration tests for the health HTTP routes.
 *
 * These tests verify the Fastify wiring (/health, /healthz, /livez) and the
 * HTTP status semantics: 503 when a core check fails, 200 when only voice
 * providers fail, 200 when everything is ok.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';

// Mock the health module *before* importing buildApp / helpers.
vi.mock('../../../src/shared/health/checks', () => ({
  checkHealth: vi.fn(),
}));

import { getApp, closeApp } from '../helpers';
import { checkHealth } from '../../../src/shared/health/checks';

const mockCheckHealth = checkHealth as unknown as ReturnType<typeof vi.fn>;

describe('GET /health', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('returns 200 when all checks pass', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'ok',
      checks: {
        db: { status: 'ok', latency_ms: 5 },
        redis: { status: 'ok', latency_ms: 3 },
        queues: { status: 'ok', latency_ms: 8 },
        telnyx: { status: 'ok', latency_ms: 120 },
        deepgram: { status: 'ok', latency_ms: 90 },
        cartesia: { status: 'ok', latency_ms: 80 },
      },
      timestamp: new Date().toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('ok');
    expect(body.checks.db.status).toBe('ok');
  });

  it('returns 503 when a core check fails', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'degraded',
      checks: {
        db: { status: 'error', latency_ms: 5, error: 'connection refused' },
        redis: { status: 'ok', latency_ms: 3 },
        queues: { status: 'ok', latency_ms: 8 },
        telnyx: { status: 'ok', latency_ms: 120 },
        deepgram: { status: 'ok', latency_ms: 90 },
        cartesia: { status: 'ok', latency_ms: 80 },
      },
      timestamp: new Date().toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('degraded');
    expect(body.checks.db.status).toBe('error');
  });

  it('returns 200 when only a voice provider fails', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'degraded',
      checks: {
        db: { status: 'ok', latency_ms: 5 },
        redis: { status: 'ok', latency_ms: 3 },
        queues: { status: 'ok', latency_ms: 8 },
        telnyx: { status: 'error', latency_ms: 120, error: 'telnyx 503' },
        deepgram: { status: 'ok', latency_ms: 90 },
        cartesia: { status: 'ok', latency_ms: 80 },
      },
      timestamp: new Date().toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.status).toBe('degraded');
    expect(body.checks.telnyx.status).toBe('error');
  });
});

describe('GET /healthz', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('mirrors /health status semantics', async () => {
    mockCheckHealth.mockResolvedValue({
      status: 'degraded',
      checks: {
        db: { status: 'error', latency_ms: 5, error: 'down' },
        redis: { status: 'ok', latency_ms: 3 },
        queues: { status: 'ok', latency_ms: 8 },
        telnyx: { status: 'ok', latency_ms: 120 },
        deepgram: { status: 'ok', latency_ms: 90 },
        cartesia: { status: 'ok', latency_ms: 80 },
      },
      timestamp: new Date().toISOString(),
    });

    const res = await app.inject({ method: 'GET', url: '/healthz' });

    expect(res.statusCode).toBe(503);
  });
});

describe('GET /livez', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('always returns 200 regardless of dependency health', async () => {
    mockCheckHealth.mockRejectedValue(new Error('should not be called'));

    const res = await app.inject({ method: 'GET', url: '/livez' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok' });
  });
});
