import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager } from '../stream/manager';
import type { CallSession, SttEvent } from '../stream/types';
import {
  connectStt,
  sendAudioToStt,
  STT_UNAVAILABLE_DEADLINE_MS,
  STT_MAX_CONSECUTIVE_FAILURES,
  STT_RETRY_BACKOFF_MS,
} from '../stream/stt-bridge';
import { handleSttEvent } from '../stream/llm-handler';
import { finishCall } from '../stream/call-ending';
import { speakTtsStreamed } from '../stream/tts-handler';

vi.mock('../stream/call-ending', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream/call-ending')>()),
  finishCall: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../stream/tts-handler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream/tts-handler')>()),
  speakTtsStreamed: vi.fn().mockResolvedValue(undefined),
}));

type SocketHandler = (...args: never[]) => void;

function makeConnectingSocket() {
  const handlers = new Map<string, SocketHandler>();
  const socket = {
    readyState: WebSocket.CONNECTING,
    on: vi.fn((event: string, handler: SocketHandler) => {
      handlers.set(event, handler);
      return socket;
    }),
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
  } as unknown as WebSocket;
  return { socket, handlers };
}

function makeSession(managerPhone?: string): CallSession {
  const manager = new CallSessionManager();
  return manager.create({
    callControlId: 'cc-stt-resilience',
    callSessionId: 'cs-stt-resilience',
    from: '+33100000000',
    to: '+33100000001',
    restaurantId: 'restaurant-stt-resilience',
    restaurantName: 'Chez Test',
    managerPhone,
    systemPrompt: 'Assistant vocal de test.',
    isVip: false,
    telnyxWs: {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    } as unknown as WebSocket,
    callLegId: 'leg-stt-resilience',
    codec: 'PCMU',
  });
}

function makeManager() {
  return {
    transition: vi.fn((session: CallSession, state: CallSession['state']) => {
      session.state = state;
      return true;
    }),
    handoffToManager: vi.fn(async (session: CallSession) => {
      session.handoffInProgress = true;
      return 'Transfert accepté';
    }),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('résilience STT', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-only-elevenlabs-key');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('sur 401 simulé, ne tente qu’une connexion, parle une fois puis transfère au gérant', async () => {
    const session = makeSession('+33100000002');
    session.state = 'LISTENING';
    const manager = makeManager();
    const { socket, handlers } = makeConnectingSocket();
    const createSocket = vi.fn(() => socket);
    const attempt = connectStt(
      session,
      (event: SttEvent) => handleSttEvent(event, session, manager as never),
      createSocket,
    );
    const response = { statusCode: 401, resume: vi.fn() };
    handlers.get('unexpected-response')?.({} as never, response as never);

    await expect(attempt).rejects.toThrow('HTTP 401');
    await flushMicrotasks();
    sendAudioToStt(session, Buffer.from('unused audio').toString('base64'));

    expect(createSocket).toHaveBeenCalledOnce();
    expect(speakTtsStreamed).toHaveBeenCalledOnce();
    expect(speakTtsStreamed).toHaveBeenCalledWith(
      session,
      'Je suis désolé, la transcription est temporairement indisponible. Je vous mets en relation avec le gérant.',
    );
    expect(manager.handoffToManager).toHaveBeenCalledOnce();
    expect(manager.transition).toHaveBeenCalledWith(session, 'PROCESSING');
    expect(manager.transition).toHaveBeenCalledWith(session, 'SPEAKING');
    expect(finishCall).not.toHaveBeenCalled();
  });

  it('sur 401 simulé sans ligne gérant, prononce le repli et termine l’appel', async () => {
    const session = makeSession();
    const manager = makeManager();
    const { socket, handlers } = makeConnectingSocket();
    const attempt = connectStt(
      session,
      (event: SttEvent) => handleSttEvent(event, session, manager as never),
      () => socket,
    );
    handlers.get('unexpected-response')?.(
      {} as never,
      { statusCode: 403, resume: vi.fn() } as never,
    );

    await expect(attempt).rejects.toThrow('HTTP 403');
    await flushMicrotasks();

    expect(finishCall).toHaveBeenCalledOnce();
    expect(finishCall).toHaveBeenCalledWith(
      session,
      manager,
      'Je suis désolé, la transcription est temporairement indisponible. Vous pouvez rappeler un peu plus tard ou réserver en ligne. Au revoir.',
    );
    expect(manager.handoffToManager).not.toHaveBeenCalled();
  });

  it('respecte le backoff borné et déclenche le repli après quatre échecs consécutifs', async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const onEvent = vi.fn();
    const sockets: ReturnType<typeof makeConnectingSocket>[] = [];
    const createSocket = vi.fn(() => {
      const next = makeConnectingSocket();
      sockets.push(next);
      return next.socket;
    });
    let attempt = connectStt(session, onEvent, createSocket).catch(() => undefined);
    const failCurrentAttempt = async () => {
      const socket = sockets.at(-1);
      socket?.handlers.get('error')?.(new Error('socket failed') as never);
      await attempt;
    };

    await failCurrentAttempt();
    for (let index = 0; index < 50; index++) {
      sendAudioToStt(session, Buffer.from('frame').toString('base64'));
    }
    expect(createSocket).toHaveBeenCalledOnce();
    expect(STT_RETRY_BACKOFF_MS).toEqual([500, 1_000, 2_000]);
    expect(STT_MAX_CONSECUTIVE_FAILURES).toBe(4);

    for (const delay of STT_RETRY_BACKOFF_MS) {
      await vi.advanceTimersByTimeAsync(delay);
      attempt = session.sttReady?.catch(() => undefined) ?? Promise.resolve();
      await failCurrentAttempt();
    }

    expect(createSocket).toHaveBeenCalledTimes(STT_MAX_CONSECUTIVE_FAILURES);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Unavailable', reason: 'connection' }),
    );
    expect(session.sttFallbackTriggered).toBe(true);
  });

  it('ne remet pas le compteur à zéro sur des sockets qui s’ouvrent puis retombent', async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const onEvent = vi.fn();
    const sockets: ReturnType<typeof makeConnectingSocket>[] = [];
    const createSocket = vi.fn(() => {
      const next = makeConnectingSocket();
      sockets.push(next);
      return next.socket;
    });

    connectStt(session, onEvent, createSocket).catch(() => undefined);
    const attempts = [0, ...STT_RETRY_BACKOFF_MS];
    for (let index = 0; index < attempts.length; index++) {
      if (index > 0) await vi.advanceTimersByTimeAsync(attempts[index]);
      const current = sockets.at(-1);
      expect(current).toBeDefined();
      Object.defineProperty(current!.socket, 'readyState', { value: WebSocket.OPEN });
      current!.handlers.get('open')?.();
      const onClose = current!.handlers.get('close') as
        | ((code: number, reason: Buffer) => void)
        | undefined;
      onClose?.(1006, Buffer.from('connection flapped'));
    }

    expect(createSocket).toHaveBeenCalledTimes(STT_MAX_CONSECUTIVE_FAILURES);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Unavailable', reason: 'connection' }),
    );
    expect(session.sttFallbackTriggered).toBe(true);
  });

  it('déclenche le repli si aucune connexion n’aboutit avant 10 secondes', async () => {
    vi.useFakeTimers();
    const session = makeSession();
    const onEvent = vi.fn();
    const sockets: ReturnType<typeof makeConnectingSocket>[] = [];
    const connect = connectStt(session, onEvent, () => {
      const next = makeConnectingSocket();
      sockets.push(next);
      return next.socket;
    }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(STT_UNAVAILABLE_DEADLINE_MS);
    await connect;

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'Unavailable', reason: 'connection' }),
    );
    expect(sockets.length).toBeLessThan(STT_MAX_CONSECUTIVE_FAILURES);
    expect(session.sttFallbackTriggered).toBe(true);
  });
});
