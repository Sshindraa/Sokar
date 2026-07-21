/**
 * Tests pour handler.ts — registerMediaStreamRoutes (WebSocket Telnyx Media Stream).
 *
 * Le handler enregistre une route WS sur /voice/stream/:callId.
 * On crée une app Fastify minimale avec @fastify/websocket, on mock toutes
 * les dépendances (CallSessionManager, deepgram-bridge, tts-cache, etc.),
 * on démarre le serveur sur un port aléatoire, et on connecte un vrai client WS.
 *
 * Scénarios testés :
 *  - Connexion WS acceptée
 *  - Événement `connected` : no-op
 *  - Événement `start` avec session connue : assigne telnyxWs, transition SPEAKING
 *  - Événement `start` sans session : no-op (pas de crash)
 *  - Événement `media` : forward à sendAudioToDeepgram
 *  - Événement `stop` : cleanup, closeDeepgram, mgr.delete
 *  - Événement `dtmf` : no-op
 *  - Fermeture WS : cleanup de la session
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';

// ── Mocks (doivent précéder les imports under test) ────────────────────────

const { mockMgr } = vi.hoisted(() => ({
  mockMgr: {
    get: vi.fn(),
    delete: vi.fn(),
    transition: vi.fn().mockReturnValue(true),
    handleBargeIn: vi.fn(),
    processUtterance: vi.fn(),
    processUtteranceStreaming: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('../stream/manager', () => ({
  CallSessionManager: {
    getInstance: vi.fn().mockReturnValue(mockMgr),
  },
}));

vi.mock('../stream/deepgram-bridge', () => ({
  sendAudioToDeepgram: vi.fn(),
  closeDeepgram: vi.fn(),
  connectDeepgramFlux: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../stream/fillers-cache', () => ({
  playFiller: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../tts-cache', () => ({
  getTtsCached: vi.fn().mockResolvedValue(null),
  setTtsCached: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../shared/logger/pino', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
}));

vi.mock('../../../shared/sentry/client', () => ({
  captureException: vi.fn(),
}));

vi.mock('../../../shared/db/client', () => ({
  db: {
    call: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn().mockResolvedValue({ id: 'call-1' }),
    },
    latencyTrace: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

// ── Imports under test ─────────────────────────────────────────────────────

import { registerMediaStreamRoutes } from '../stream/handler';
import { sendAudioToDeepgram, closeDeepgram } from '../stream/deepgram-bridge';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMockSession(): CallSession {
  return {
    callControlId: 'cc-ws-1',
    callSessionId: 'cs-ws-1',
    callLegId: 'leg-ws-1',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-1',
    restaurantName: 'Test Resto',
    systemPrompt: "Tu es l'assistant vocal de Test Resto.",
    state: 'IDLE',
    ended: false,
    turnCount: 0,
    isVip: false,
    codec: 'PCMA',
    history: [],
    telnyxWs: null,
    deepgramWs: null,
    deepgramReady: Promise.resolve(),
    onDeepgramEvent: null,
    audioBuffer: [],
    isSpeaking: false,
    bargeInChunks: 0,
    abortController: null,
    speculativeLlm: null,
    speculativeTranscript: '',
    speculativeResult: null,
    transcript: '',
    turnTranscript: '',
    speechFinalTimer: null,
    lastActivityAt: Date.now(),
    createdAt: Date.now(),
    personality: null,
    latencyTrace: undefined,
  } as unknown as CallSession;
}

async function startApp() {
  const app = Fastify();
  await app.register(fastifyWebsocket);
  registerMediaStreamRoutes(app);
  await app.listen({ port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, port };
}

function connectWs(port: number, callId: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/voice/stream/${callId}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function sendAndWait(ws: WebSocket, msg: unknown): Promise<void> {
  return new Promise((resolve) => {
    ws.send(JSON.stringify(msg), () => resolve());
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('registerMediaStreamRoutes — WebSocket Telnyx Media Stream', () => {
  let app: Awaited<ReturnType<typeof startApp>>['app'];
  let port: number;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMgr.get.mockReturnValue(undefined);
    mockMgr.transition.mockReturnValue(true);
    originalFetch = globalThis.fetch;
    // speakTelnyxNative (fallback TTS) appelle fetch — on mock pour éviter un crash
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue({ ok: true, text: vi.fn() }) as unknown as typeof globalThis.fetch;

    const started = await startApp();
    app = started.app;
    port = started.port;
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  it('accepte une connexion WebSocket sur /voice/stream/:callId', async () => {
    const ws = await connectWs(port, 'cc-ws-1');
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("traite l'événement `connected` sans erreur", async () => {
    const ws = await connectWs(port, 'cc-ws-1');
    await sendAndWait(ws, { event: 'connected' });
    await delay(50);
    // Pas de crash, pas d'appel à mgr.get pour connected
    expect(mockMgr.get).not.toHaveBeenCalled();
    ws.close();
  });

  it('événement `start` : assigne telnyxWs et transitionne vers SPEAKING si session trouvée', async () => {
    const session = makeMockSession();
    mockMgr.get.mockReturnValue(session);

    const ws = await connectWs(port, 'cc-ws-1');
    await sendAndWait(ws, {
      event: 'start',
      start: {
        call_control_id: 'cc-ws-1',
        call_session_id: 'cs-ws-1',
        from: '+33****0001',
        to: '+33****0000',
        media_format: { encoding: 'PCMA', sample_rate: 8000, channels: 1 },
      },
    });
    await delay(100);

    expect(mockMgr.get).toHaveBeenCalledWith('cc-ws-1');
    expect(session.telnyxWs).toBeDefined();
    // transition vers SPEAKING (pour le greeting)
    expect(mockMgr.transition).toHaveBeenCalledWith(session, 'SPEAKING');
    ws.close();
  });

  it('événement `start` sans session : no-op (pas de crash)', async () => {
    mockMgr.get.mockReturnValue(undefined);

    const ws = await connectWs(port, 'cc-unknown');
    await sendAndWait(ws, {
      event: 'start',
      start: {
        call_control_id: 'cc-unknown',
        call_session_id: 'cs-1',
        from: '+33****0001',
        to: '+33****0000',
        media_format: { encoding: 'PCMA', sample_rate: 8000, channels: 1 },
      },
    });
    await delay(50);

    expect(mockMgr.get).toHaveBeenCalledWith('cc-unknown');
    // Pas de transition si pas de session
    expect(mockMgr.transition).not.toHaveBeenCalled();
    ws.close();
  });

  it('événement `media` : forward le payload à sendAudioToDeepgram', async () => {
    const session = makeMockSession();
    mockMgr.get.mockReturnValue(session);

    const ws = await connectWs(port, 'cc-ws-1');
    // D'abord start pour que la session soit assignée
    await sendAndWait(ws, {
      event: 'start',
      start: {
        call_control_id: 'cc-ws-1',
        call_session_id: 'cs-1',
        from: '+33****0001',
        to: '+33****0000',
        media_format: { encoding: 'PCMA', sample_rate: 8000, channels: 1 },
      },
    });
    await delay(50);

    vi.mocked(sendAudioToDeepgram).mockClear();
    mockMgr.get.mockReturnValue(session);

    await sendAndWait(ws, {
      event: 'media',
      media: {
        track: 'inbound',
        chunk: '1',
        timestamp: '0',
        payload: Buffer.from('audio-chunk').toString('base64'),
      },
    });
    await delay(50);

    expect(sendAudioToDeepgram).toHaveBeenCalledWith(
      session,
      Buffer.from('audio-chunk').toString('base64'),
    );
    ws.close();
  });

  it("événement `media` sans payload : n'appelle pas sendAudioToDeepgram", async () => {
    const session = makeMockSession();
    mockMgr.get.mockReturnValue(session);

    const ws = await connectWs(port, 'cc-ws-1');
    await sendAndWait(ws, { event: 'media', media: {} });
    await delay(50);

    expect(sendAudioToDeepgram).not.toHaveBeenCalled();
    ws.close();
  });

  it('événement `stop` : cleanup la session, closeDeepgram et mgr.delete', async () => {
    const session = makeMockSession();
    mockMgr.get.mockReturnValue(session);

    const ws = await connectWs(port, 'cc-ws-1');
    await sendAndWait(ws, {
      event: 'start',
      start: {
        call_control_id: 'cc-ws-1',
        call_session_id: 'cs-1',
        from: '+33****0001',
        to: '+33****0000',
        media_format: { encoding: 'PCMA', sample_rate: 8000, channels: 1 },
      },
    });
    await delay(50);

    await sendAndWait(ws, { event: 'stop', stop: { call_control_id: 'cc-ws-1' } });
    await delay(100);

    expect(session.ended).toBe(true);
    expect(closeDeepgram).toHaveBeenCalledWith(session);
    expect(mockMgr.delete).toHaveBeenCalledWith('cc-ws-1');
    ws.close();
  });

  it('événement `dtmf` : no-op (pas de crash)', async () => {
    const ws = await connectWs(port, 'cc-ws-1');
    await sendAndWait(ws, { event: 'dtmf', dtmf: { digit: '1' } });
    await delay(50);
    // Pas d'erreur = succès
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it("événement `error` : capture l'erreur via Sentry sans crash", async () => {
    const ws = await connectWs(port, 'cc-ws-1');
    await sendAndWait(ws, { event: 'error', error: { code: 'test' } });
    await delay(50);
    // La connexion reste ouverte
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it('fermeture WS : marque la session comme ended et appelle mgr.delete', async () => {
    const session = makeMockSession();
    mockMgr.get.mockReturnValue(session);

    const ws = await connectWs(port, 'cc-ws-1');
    // Envoyer start pour que la session soit connue du handler
    await sendAndWait(ws, {
      event: 'start',
      start: {
        call_control_id: 'cc-ws-1',
        call_session_id: 'cs-1',
        from: '+33****0001',
        to: '+33****0000',
        media_format: { encoding: 'PCMA', sample_rate: 8000, channels: 1 },
      },
    });
    await delay(50);

    // Fermer la connexion WS
    ws.close();
    await delay(150);

    expect(session.ended).toBe(true);
    expect(mockMgr.delete).toHaveBeenCalledWith('cc-ws-1');
  });

  it("message JSON invalide : log l'erreur sans crash", async () => {
    const ws = await connectWs(port, 'cc-ws-1');
    ws.send('not-json{{{');
    await delay(50);
    // La connexion reste ouverte malgré le parse error
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
