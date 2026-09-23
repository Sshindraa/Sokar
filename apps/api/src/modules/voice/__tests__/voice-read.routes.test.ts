import { randomBytes } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const URL = '/api/internal/voice/calls/latest?restaurantId=test-rest-1';
const READ_KEY = randomBytes(16).toString('hex');

describe('internal voice read route', () => {
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('SOKAR_VOICE_READ_TOKEN', READ_KEY);
    vi.mocked(db.call.findMany).mockResolvedValue([]);
    vi.mocked(db.voiceTurnTelemetry.findMany).mockResolvedValue([]);
  });

  it('returns 503 when the token is not configured', async () => {
    vi.stubEnv('SOKAR_VOICE_READ_TOKEN', '');
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { 'x-sokar-voice-read-token': READ_KEY },
    });
    expect(response.statusCode).toBe(503);
    expect(db.call.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when the token is missing or wrong', async () => {
    const app = await getApp();
    const missing = await app.inject({ method: 'GET', url: URL });
    const wrong = await app.inject({
      method: 'GET',
      url: URL,
      headers: { 'x-sokar-voice-read-token': 'nope' },
    });
    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(db.call.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when the restaurant has no call', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { authorization: `Bearer ${READ_KEY}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('returns the latest call with redacted text and ordered turns', async () => {
    const now = new Date('2026-09-23T10:00:00Z');
    vi.mocked(db.call.findMany).mockResolvedValue([
      {
        id: 'call-1',
        restaurantId: 'test-rest-1',
        durationSec: 42,
        transcript: 'Rappelez-moi au 06 12 34 56 78 ou jean@example.com',
        intent: null,
        outcome: null,
        sttProvider: 'elevenlabs',
        llmProvider: 'groq',
        ttsProvider: 'cartesia',
        carrier: 'telnyx',
        recordingStatus: 'NOT_REQUESTED',
        recordingError: null,
        createdAt: now,
        updatedAt: now,
      },
    ] as never);
    vi.mocked(db.voiceTurnTelemetry.findMany).mockResolvedValue([
      {
        id: 't1',
        callId: 'call-1',
        sequence: 1,
        path: 'llm',
        startedAt: now,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ] as never);

    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: URL,
      headers: { 'x-sokar-voice-read-token': READ_KEY },
    });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.call.transcript).toBe('Rappelez-moi au [PHONE] ou [EMAIL]');
    expect(body.call).not.toHaveProperty('callerPhone');
    expect(body.turns).toHaveLength(1);
    expect(db.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'test-rest-1' },
        select: expect.not.objectContaining({ callerPhone: true }),
      }),
    );
    expect(db.voiceTurnTelemetry.findMany).toHaveBeenCalledWith({
      where: { callId: 'call-1' },
      orderBy: { sequence: 'asc' },
    });
  });
});
