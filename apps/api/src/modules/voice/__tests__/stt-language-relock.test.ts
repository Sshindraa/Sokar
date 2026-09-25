import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CallSessionManager } from '../stream/manager';
import type { CallSession } from '../stream/types';
import {
  beginFrenchSttRelock,
  closeStt,
  sendAudioToStt,
  type SttWebSocketFactory,
} from '../stream/stt-bridge';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  send = vi.fn();
  close = vi.fn((code = 1000, reason = '') => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close', code, Buffer.from(reason));
  });
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
  });
}

function makeSession(): CallSession {
  (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
    new CallSessionManager();
  const socket = new FakeSocket();
  socket.readyState = WebSocket.OPEN;
  return CallSessionManager.getInstance().create({
    callControlId: 'cc-language-relock',
    callSessionId: 'cs-language-relock',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-relock',
    restaurantName: 'Test',
    systemPrompt: 'Assistant vocal de test.',
    isVip: false,
    telnyxWs: socket as unknown as WebSocket,
    callLegId: 'leg-language-relock',
    codec: 'PCMU',
  });
}

function audioMessages(socket: FakeSocket): Buffer[] {
  return socket.send.mock.calls.map(([raw]) => {
    const payload = JSON.parse(String(raw)) as { audio_base_64: string };
    return Buffer.from(payload.audio_base_64, 'base64');
  });
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('relock Scribe après verrou français', () => {
  it('attend SPEAKING puis rejoue les octets tamponnés une seule fois', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key-placeholder');
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'true');
    vi.stubEnv('VOICE_STT_FILTER_BACKGROUND', 'true');
    vi.stubEnv('VOICE_STT_CHUNK_MS', '20');

    const session = makeSession();
    const oldSocket = session.telnyxWs as unknown as FakeSocket;
    session.sttWs = oldSocket as unknown as WebSocket;
    session.languageLocked = 'fr';
    session.sttRelockPending = true;
    session.state = 'LISTENING';
    const pendingChunk = Buffer.from('partial-before-relock');
    session.sttChunkBuffer = pendingChunk;
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const factory: SttWebSocketFactory = (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    };
    session.onAgentSpeaking = () => beginFrenchSttRelock(session, factory);

    beginFrenchSttRelock(session, factory);
    expect(urls).toHaveLength(0);
    expect(session.sttRelockPending).toBe(true);

    CallSessionManager.getInstance().transition(session, 'PROCESSING');
    CallSessionManager.getInstance().transition(session, 'SPEAKING');
    expect(urls).toHaveLength(1);
    expect(oldSocket.close).not.toHaveBeenCalled();
    expect(oldSocket.send).not.toHaveBeenCalled();
    expect(session.audioBuffer).toEqual([pendingChunk]);
    const relockUrl = new URL(urls[0]);
    expect(relockUrl.searchParams.get('language_code')).toBe('fr');
    expect(relockUrl.searchParams.get('include_language_detection')).toBe('false');
    expect(relockUrl.searchParams.get('secondary_languages')).toBeNull();
    expect(relockUrl.searchParams.get('filter_background_audio')).toBe('true');

    const inbound = Buffer.alloc(160, 0x33);
    sendAudioToStt(session, inbound.toString('base64'));
    expect(session.audioBuffer).toEqual([pendingChunk, inbound]);

    sockets[0].readyState = WebSocket.OPEN;
    sockets[0].emit('open');
    await Promise.resolve();
    expect(oldSocket.close).toHaveBeenCalledOnce();
    expect(audioMessages(sockets[0])).toEqual([pendingChunk, inbound]);
    expect(session.audioBuffer).toHaveLength(0);
    closeStt(session);
  });

  it('garde l’ancien socket auto et lui rejoue une fois l’audio si le handshake français échoue', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ELEVENLABS_API_KEY', 'test-key-placeholder');
    vi.stubEnv('VOICE_STT_LANGUAGE_LOCK', 'true');
    vi.stubEnv('VOICE_STT_FILTER_BACKGROUND', 'false');

    const session = makeSession();
    const oldSocket = session.telnyxWs as unknown as FakeSocket;
    session.sttWs = oldSocket as unknown as WebSocket;
    session.languageLocked = 'fr';
    session.sttRelockPending = true;
    session.state = 'SPEAKING';
    const sockets: FakeSocket[] = [];
    const urls: string[] = [];
    const factory: SttWebSocketFactory = (url) => {
      urls.push(url);
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket as unknown as WebSocket;
    };

    beginFrenchSttRelock(session, factory);
    const inbound = Buffer.alloc(160, 0x44);
    sendAudioToStt(session, inbound.toString('base64'));
    sockets[0].emit('error', new Error('synthetic handshake failure'));
    await Promise.resolve();

    expect(urls).toHaveLength(1);
    expect(session.sttWs).toBe(oldSocket);
    expect(session.sttFrenchOnly).toBe(false);
    expect(audioMessages(oldSocket)).toEqual([inbound]);
    expect(session.sttTerminalFailure).not.toBe(true);
    closeStt(session);
  });
});
