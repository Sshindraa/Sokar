import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { CallSession } from '../stream/types';

vi.mock('../tts-cache', () => ({
  getTtsCached: vi.fn(),
  setTtsCached: vi.fn(),
}));

vi.mock('../../../shared/logger/pino', () => ({
  logger: { error: vi.fn() },
}));

vi.mock('../../../shared/sentry/client', () => ({
  captureException: vi.fn(),
}));

vi.mock('../stream/session-persistence', () => ({
  persistLatencyTrace: vi.fn().mockResolvedValue(undefined),
}));

import { getTtsCached } from '../tts-cache';
import { speakTtsStreamed } from '../stream/tts-handler';
import { TTS_FRAME_BYTES } from '../stream/constants';

const setEnv = (key: string, value: string): void => {
  (process.env as Record<string, string>)[key] = value;
};

function makeSession(codec: 'PCMA' | 'PCMU' = 'PCMA'): CallSession {
  return {
    callControlId: 'test-call',
    state: 'SPEAKING',
    ended: false,
    codec,
    telnyxWs: {
      readyState: WebSocket.OPEN,
      send: vi.fn(),
    },
    latencyTrace: undefined,
  } as unknown as CallSession;
}

describe('speakTtsStreamed — Telnyx RTP framing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv('CARTESIA_API_KEY', ['test', 'key'].join('-'));
    setEnv('CARTESIA_VOICE_ID', ['test', 'voice'].join('-'));
  });

  it('sends a cached response as lossless 100 ms frames', async () => {
    const source = Buffer.alloc(TTS_FRAME_BYTES * 2, 0x55);
    vi.mocked(getTtsCached).mockResolvedValue(source);
    const session = makeSession();

    await speakTtsStreamed(session, 'Pouvez-vous me donner votre nom, s’il vous plaît ?');

    expect(getTtsCached).toHaveBeenCalled();
    const messages = vi
      .mocked(session.telnyxWs.send)
      .mock.calls.map(([message]) => JSON.parse(message as string));
    const frames = messages.map((message) => Buffer.from(message.media.payload, 'base64'));

    expect(frames).toHaveLength(2);
    expect(frames.every((frame) => frame.length === TTS_FRAME_BYTES)).toBe(true);
    expect(Buffer.concat(frames)).toEqual(source);
  });

  it('pads a partial PCMU frame with the codec silence byte', async () => {
    const source = Buffer.alloc(TTS_FRAME_BYTES + 3, 0x44);
    vi.mocked(getTtsCached).mockResolvedValue(source);
    const session = makeSession('PCMU');

    await speakTtsStreamed(session, 'Pouvez-vous me donner votre nom, s’il vous plaît ?');

    const secondFrame = Buffer.from(
      JSON.parse(vi.mocked(session.telnyxWs.send).mock.calls[1][0] as string).media.payload,
      'base64',
    );
    expect(secondFrame.subarray(0, 3)).toEqual(source.subarray(TTS_FRAME_BYTES));
    expect(secondFrame.subarray(3)).toEqual(Buffer.alloc(TTS_FRAME_BYTES - 3, 0xff));
  });
});
