import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';
import { CallSessionManager } from '../stream/manager';
import {
  closeStt,
  flushSttChunkBuffer,
  handleSttMessage,
  resumeSttAfterOpen,
  sendAudioToStt,
  setSttSpellingProfile,
} from '../stream/stt-bridge';
import {
  getSttChunkMs,
  parseSttChunkMs,
  sttChunkMsSchema,
  STT_CHUNK_SAFETY_EXTRA_MS,
} from '../../../shared/stt-chunking';

/** Trame G.711 de 20 ms à 8 kHz. */
const FRAME_BYTES = 160;

function makeWsMock(): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    on: vi.fn(),
  } as unknown as WebSocket;
}

function makeSession(codec: 'PCMA' | 'PCMU' | 'L16' = 'PCMU'): CallSession {
  (CallSessionManager as unknown as { instance: CallSessionManager }).instance =
    new CallSessionManager();
  return CallSessionManager.getInstance().create({
    callControlId: 'cc-chunk-1',
    callSessionId: 'cs-chunk-1',
    from: '+33****0001',
    to: '+33****0000',
    restaurantId: 'rest-chunk-1',
    restaurantName: 'Test',
    systemPrompt: "Tu es l'assistant vocal de Test.",
    isVip: false,
    telnyxWs: makeWsMock(),
    callLegId: 'leg-chunk-1',
    codec,
  });
}

/** Payloads audio effectivement envoyés à Scribe, dans l'ordre. */
function sentAudio(ws: WebSocket): Buffer[] {
  return vi.mocked(ws.send).mock.calls.map((call) => {
    const payload = JSON.parse(String(call[0])) as { audio_base_64: string };
    return Buffer.from(payload.audio_base_64, 'base64');
  });
}

function frame(seed: number): Buffer {
  return Buffer.from(Array.from({ length: FRAME_BYTES }, (_, index) => (seed * 31 + index) & 0xff));
}

function sendFrame(session: CallSession, buffer: Buffer): void {
  sendAudioToStt(session, buffer.toString('base64'));
}

describe('VOICE_STT_CHUNK_MS (validation)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepte le défaut et les multiples de 20 entre 40 et 200', () => {
    for (const value of [20, 40, 60, 100, 140, 200]) {
      expect(sttChunkMsSchema.safeParse(String(value)).success).toBe(true);
    }
  });

  it('refuse une valeur non supportée', () => {
    expect(sttChunkMsSchema.safeParse('30').success).toBe(false);
    expect(sttChunkMsSchema.safeParse('500').success).toBe(false);
    expect(sttChunkMsSchema.safeParse('21').success).toBe(false);
    expect(sttChunkMsSchema.safeParse('abc').success).toBe(false);
  });

  it('retombe sur 20 quand la variable est absente ou vide', () => {
    expect(sttChunkMsSchema.parse(undefined)).toBe(20);
    expect(sttChunkMsSchema.parse('')).toBe(20);
    expect(parseSttChunkMs('  100  ')).toBe(100);
  });

  it('getSttChunkMs ignore une valeur invalide plutôt que de casser l’audio', () => {
    vi.stubEnv('VOICE_STT_CHUNK_MS', '30');
    expect(getSttChunkMs()).toBe(20);
    vi.stubEnv('VOICE_STT_CHUNK_MS', '100');
    expect(getSttChunkMs()).toBe(100);
  });
});

describe('regroupement des trames', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each([20, 100])('compte les mêmes échantillons PCMA et L16 à %i ms', (chunkMs) => {
    vi.stubEnv('VOICE_STT_CHUNK_MS', String(chunkMs));
    const count = 5;
    for (const codec of ['PCMA', 'L16'] as const) {
      const session = makeSession(codec);
      session.sttWs = makeWsMock();
      const networkFrame = Buffer.alloc(codec === 'PCMA' ? 160 : 640, 0x55);
      for (let i = 0; i < count; i++) sendFrame(session, networkFrame);
      flushSttChunkBuffer(session);
      expect(session.voiceUsage?.sttAudioSamples).toBe(count * (codec === 'PCMA' ? 160 : 320));
      expect(Buffer.concat(sentAudio(session.sttWs)).length).toBe(
        count * 320 * (codec === 'PCMA' ? 1 : 2),
      );
    }
  });

  it('flag à 20 : un message par trame, octet pour octet comme aujourd’hui', () => {
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    const frames = [frame(1), frame(2), frame(3)];

    for (const value of frames) sendFrame(session, value);

    const sent = sentAudio(session.sttWs);
    expect(sent).toHaveLength(frames.length);
    expect(sent).toEqual(frames);
  });

  it('flag à 100 : 5 trames donnent un seul message, ordre et contenu préservés', () => {
    vi.stubEnv('VOICE_STT_CHUNK_MS', '100');
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    const frames = [frame(1), frame(2), frame(3), frame(4), frame(5)];

    for (const value of frames.slice(0, 4)) sendFrame(session, value);
    expect(sentAudio(session.sttWs)).toHaveLength(0);

    sendFrame(session, frames[4]);
    const sent = sentAudio(session.sttWs);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(Buffer.concat(frames));
  });

  it('concaténation des messages = concaténation des trames reçues', () => {
    vi.stubEnv('VOICE_STT_CHUNK_MS', '40');
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    const frames = Array.from({ length: 7 }, (_, index) => frame(index + 1));

    for (const value of frames) sendFrame(session, value);

    // 2 trames par message de 40 ms : six trames sont parties, la septième
    // attend encore dans le tampon.
    expect(Buffer.concat(sentAudio(session.sttWs))).toEqual(Buffer.concat(frames.slice(0, 6)));

    flushSttChunkBuffer(session);
    expect(Buffer.concat(sentAudio(session.sttWs))).toEqual(Buffer.concat(frames));
  });

  it('PCMA : la durée cible se compte après décodage en PCM16', () => {
    vi.stubEnv('VOICE_STT_CHUNK_MS', '100');
    const session = makeSession('PCMA');
    session.sttWs = makeWsMock();
    // 5 trames PCMA décodées = 5 × 320 octets PCM16 = 1600 octets = 100 ms.
    for (let index = 0; index < 5; index++) sendFrame(session, frame(index));
    const sent = sentAudio(session.sttWs);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(5 * FRAME_BYTES * 2);
  });

  it('timer de sécurité : un tampon partiel part après la durée cible + 20 ms', () => {
    vi.useFakeTimers();
    vi.stubEnv('VOICE_STT_CHUNK_MS', '100');
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();

    sendFrame(session, frame(1));
    expect(sentAudio(session.sttWs)).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(sentAudio(session.sttWs)).toHaveLength(0);

    vi.advanceTimersByTime(STT_CHUNK_SAFETY_EXTRA_MS);
    const sent = sentAudio(session.sttWs);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(frame(1));
  });
});

describe('vidage du tampon sur les transitions', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('VOICE_STT_CHUNK_MS', '100');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('barge-in : le tampon part avant l’interruption', () => {
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    session.state = 'SPEAKING';
    sendFrame(session, frame(1));
    expect(sentAudio(session.sttWs)).toHaveLength(0);

    handleSttMessage(session, { message_type: 'partial_transcript', text: 'quatre personnes' });

    const sent = sentAudio(session.sttWs);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual(frame(1));
  });

  it('changement de profil d’épellation : le tampon part', () => {
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    sendFrame(session, frame(1));

    setSttSpellingProfile(session, true);

    expect(sentAudio(session.sttWs)).toEqual([frame(1)]);
  });

  it('fin de tour : le tampon part avant le traitement du tour', () => {
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    sendFrame(session, frame(1));

    handleSttMessage(session, {
      message_type: 'committed_transcript_with_timestamps',
      text: 'quatre personnes',
    });

    expect(sentAudio(session.sttWs)).toEqual([frame(1)]);
  });

  it('fermeture : le tampon part avant la fermeture de la socket', () => {
    const session = makeSession('PCMU');
    const ws = makeWsMock();
    session.sttWs = ws;
    sendFrame(session, frame(1));

    closeStt(session);

    expect(sentAudio(ws)).toEqual([frame(1)]);
    expect(vi.mocked(ws.close)).toHaveBeenCalled();
  });

  it('reconnexion : file puis tampon, dans l’ordre, sans perte ni doublon', () => {
    const session = makeSession('PCMU');
    session.sttWs = null;
    // Trames reçues socket fermée : le tampon se remplit puis se vide dans la
    // file de reconnexion, et un reste partiel subsiste dans le tampon courant.
    const frames = Array.from({ length: 7 }, (_, index) => frame(index + 1));
    for (const value of frames) sendFrame(session, value);

    session.sttWs = makeWsMock();
    resumeSttAfterOpen(session);

    expect(Buffer.concat(sentAudio(session.sttWs))).toEqual(Buffer.concat(frames));
    expect(session.audioBuffer).toHaveLength(0);
    expect(session.sttChunkBuffer ?? null).toBeNull();
  });

  it('flushSttChunkBuffer sans tampon n’envoie rien', () => {
    const session = makeSession('PCMU');
    session.sttWs = makeWsMock();
    flushSttChunkBuffer(session);
    expect(sentAudio(session.sttWs)).toHaveLength(0);
  });
});
