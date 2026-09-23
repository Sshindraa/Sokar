import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    call: { findMany: vi.fn(), findUnique: vi.fn() },
    voiceTurnTelemetry: { findMany: vi.fn() },
    voiceDebugTurn: { findMany: vi.fn() },
  },
}));
vi.mock('../../../shared/db/client', () => ({ db: mockDb }));

import { voiceReadRoutes } from '../voice-read.routes';

const TOKEN = ['test', 'voice', 'read', 'token'].join('-');

const call = {
  id: 'call-1',
  restaurantId: 'rest-test',
  createdAt: new Date('2026-09-24T10:00:00.000Z'),
  durationSec: 42,
  intent: 'RESERVATION',
  outcome: 'RESERVED',
  sttProvider: 'scribe',
  llmProvider: 'groq',
  ttsProvider: 'cartesia',
};

const turn = {
  turnId: 'turn-1',
  sequence: 1,
  path: 'llm',
  speechDurationMs: 1200,
  speechToSttFinalMs: 300,
  llmFirstTokenMs: 250,
  llmFirstPhraseMs: 400,
  llmDurationMs: 600,
  availabilityDurationMs: null,
  ttsFirstByteMs: 150,
  sttFinalToAudioMs: 700,
  totalE2eMs: 1900,
  interrupted: false,
  loopDetected: false,
  completed: true,
  startedAt: new Date('2026-09-24T10:00:01.000Z'),
};

const dialogue = {
  turnId: 'turn-1',
  callerText: 'Une table pour deux demain',
  agentText: 'Vers quelle heure ?',
  fillerText: null,
  speechAct: 'content',
  tools: [],
};

describe('voiceReadRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    process.env.SOKAR_VOICE_READ_TOKEN = TOKEN;
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'rest-test';
    mockDb.call.findMany.mockResolvedValue([call]);
    mockDb.call.findUnique.mockResolvedValue(call);
    mockDb.voiceTurnTelemetry.findMany.mockResolvedValue([turn]);
    mockDb.voiceDebugTurn.findMany.mockResolvedValue([dialogue]);
    app = Fastify();
    await app.register(voiceReadRoutes);
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
    delete process.env.SOKAR_VOICE_READ_TOKEN;
    delete process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS;
  });

  const get = (url: string, token: string | null = TOKEN) =>
    app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  it('refuse sans jeton ou avec un mauvais jeton', async () => {
    expect(
      (await get('/api/internal/voice/calls/latest?restaurantId=rest-test', null)).statusCode,
    ).toBe(401);
    expect(
      (await get('/api/internal/voice/calls/latest?restaurantId=rest-test', 'nope')).statusCode,
    ).toBe(401);
    expect(mockDb.call.findMany).not.toHaveBeenCalled();
  });

  it('répond 503 quand le jeton serveur n’est pas configuré', async () => {
    delete process.env.SOKAR_VOICE_READ_TOKEN;
    expect((await get('/api/internal/voice/calls/latest?restaurantId=rest-test')).statusCode).toBe(
      503,
    );
  });

  it('renvoie le dernier appel avec le dialogue pour un restaurant de test', async () => {
    const res = await get('/api/internal/voice/calls/latest?restaurantId=rest-test');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.dialogueAvailable).toBe(true);
    expect(body.turns[0]).toMatchObject({
      sequence: 1,
      path: 'llm',
      callerText: 'Une table pour deux demain',
      agentText: 'Vers quelle heure ?',
      totalE2eMs: 1900,
    });
  });

  it('ne lit ni ne renvoie de dialogue hors de la liste de test', async () => {
    process.env.VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS = 'autre-restaurant';
    const body = (await get('/api/internal/voice/calls/latest?restaurantId=rest-test')).json();
    expect(mockDb.voiceDebugTurn.findMany).not.toHaveBeenCalled();
    expect(body.dialogueAvailable).toBe(false);
    expect(body.turns[0].callerText).toBeNull();
    expect(body.turns[0].totalE2eMs).toBe(1900);
  });

  it('ne sélectionne jamais le numéro, le transcript ni les champs d’enregistrement', async () => {
    await get('/api/internal/voice/calls/call-1');
    const select = mockDb.call.findUnique.mock.calls[0][0].select;
    for (const field of ['callerPhone', 'transcript', 'recordingError', 'recordingStorageKey']) {
      expect(select).not.toHaveProperty(field);
    }
  });

  it('liste les derniers appels d’un restaurant', async () => {
    const res = await get('/api/internal/voice/calls?restaurantId=rest-test&limit=5');
    expect(res.statusCode).toBe(200);
    expect(mockDb.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { restaurantId: 'rest-test' }, take: 5 }),
    );
    expect(res.json().calls).toHaveLength(1);
  });

  it('répond 404 pour un appel inconnu', async () => {
    mockDb.call.findUnique.mockResolvedValue(null);
    expect((await get('/api/internal/voice/calls/inconnu')).statusCode).toBe(404);
  });
});
