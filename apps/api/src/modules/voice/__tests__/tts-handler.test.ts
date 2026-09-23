import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { CARTESIA_MODEL } from '@sokar/config';
import type { CallSession } from '../stream/types';

vi.mock('../tts-cache', () => ({
  getTtsCached: vi.fn(),
  setTtsCached: vi.fn(),
}));

vi.mock('../../../shared/logger/pino', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../shared/sentry/client', () => ({
  captureException: vi.fn(),
}));

vi.mock('../stream/session-persistence', () => ({
  persistLatencyTrace: vi.fn().mockResolvedValue(undefined),
}));

import { getTtsCached } from '../tts-cache';
import { cleanTextForTts, getInterSentencePauseMs, speakTtsStreamed } from '../stream/tts-handler';
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

  it('serialises two fragments streamed by the LLM on the same call', async () => {
    const first = Buffer.alloc(TTS_FRAME_BYTES, 0x11);
    const second = Buffer.alloc(TTS_FRAME_BYTES, 0x22);
    vi.mocked(getTtsCached).mockImplementation(async (text) =>
      text.startsWith('Première') ? first : second,
    );
    const session = makeSession();

    await Promise.all([
      speakTtsStreamed(session, 'Première phrase.'),
      speakTtsStreamed(session, 'Deuxième phrase.'),
    ]);

    const frames = vi
      .mocked(session.telnyxWs.send)
      .mock.calls.map(([message]) =>
        Buffer.from(JSON.parse(message as string).media.payload, 'base64'),
      );
    expect(frames).toEqual([first, second]);
  });

  it('does not resume a stale fragment after a barge-in generation change', async () => {
    vi.mocked(getTtsCached).mockResolvedValue(Buffer.alloc(TTS_FRAME_BYTES, 0x11));
    const session = makeSession();
    (session as unknown as { ttsGeneration: number }).ttsGeneration = 0;

    const stalePlayback = speakTtsStreamed(session, 'Réponse interrompue.');
    (session as unknown as { ttsGeneration: number }).ttsGeneration = 1;
    await stalePlayback;

    expect(vi.mocked(session.telnyxWs.send)).not.toHaveBeenCalled();
  });
});

describe('prosodie TTS', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv('CARTESIA_API_KEY', ['test', 'key'].join('-'));
    setEnv('CARTESIA_VOICE_ID', ['test', 'voice'].join('-'));
  });

  it('normalise les heures courantes avant synthèse', () => {
    expect(cleanTextForTts('Rendez-vous à 19:30, ou 20h30.')).toBe(
      'Rendez-vous à 19 heures 30, ou 20 heures 30.',
    );
  });

  it('rend les numéros, abréviations et symboles non ambigus à l’oral', () => {
    expect(cleanTextForTts('Mme Martin : 06 12 34 56 78, menu à 25€ & -10%.')).toBe(
      'Madame Martin : 06, 12, 34, 56, 78, menu à 25 euros et -10 pour cent.',
    );
  });

  it('laisse Cartesia piloter la pause selon la ponctuation', () => {
    expect(getInterSentencePauseMs('Quel est votre nom ?')).toBe(0);
    expect(getInterSentencePauseMs('Très bien.')).toBe(0);
  });

  it('synthétise plusieurs phrases dans un seul segment pour garder la prosodie', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(Buffer.alloc(TTS_FRAME_BYTES, 0x55), { status: 200 }));
    vi.mocked(getTtsCached).mockResolvedValue(null);

    await speakTtsStreamed(makeSession(), 'Très bien. Je vérifie votre créneau.');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body)).transcript).toBe('Très bien. Je vérifie votre créneau.');
    fetchMock.mockRestore();
  });

  it('sends the detected language to Cartesia and isolates the TTS cache by language', async () => {
    const response = new Response(Buffer.alloc(TTS_FRAME_BYTES, 0x55), { status: 200 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    vi.mocked(getTtsCached).mockResolvedValue(null);
    const session = makeSession();
    session.voiceLanguageCode = 'en';

    await speakTtsStreamed(session, 'Your table is confirmed.');

    const [request] = fetchMock.mock.calls;
    const body = JSON.parse(String(request?.[1]?.body));
    expect(body.model_id).toBe(CARTESIA_MODEL);
    expect(body.locale).toBe('en-US');
    expect(body.normalization).toBe('auto');
    expect(body.language).toBeUndefined();
    expect(String(vi.mocked(getTtsCached).mock.calls[0]?.[1])).toContain(
      `|${CARTESIA_MODEL}|en-US|`,
    );
    fetchMock.mockRestore();
  });
});

describe('speakTtsStreamed — dialogue des appels de test', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEnv('CARTESIA_API_KEY', ['test', 'key'].join('-'));
    setEnv('CARTESIA_VOICE_ID', ['test', 'voice'].join('-'));
    setEnv('VOICE_DEBUG_TRANSCRIPT_RESTAURANT_IDS', 'rest-test');
  });

  function makeDebugSession(): CallSession {
    return Object.assign(makeSession(), {
      restaurantId: 'rest-test',
      ttsGeneration: 0,
      currentTurn: { id: 'turn-1', sequence: 1, startedAt: 0 },
    }) as unknown as CallSession;
  }

  const spokenStatus = (session: CallSession) =>
    session.currentTurn?.debugDialogue?.agentSpeech.map((entry) => entry.status);

  it('marque « prononcée » une réplique lue jusqu’au bout', async () => {
    vi.mocked(getTtsCached).mockResolvedValue(Buffer.alloc(TTS_FRAME_BYTES * 2, 0x11));
    const session = makeDebugSession();

    await speakTtsStreamed(session, 'Vous serez combien ?');

    expect(spokenStatus(session)).toEqual(['played']);
  });

  it('marque « interrompue » une réplique coupée après la première trame', async () => {
    vi.mocked(getTtsCached).mockResolvedValue(Buffer.alloc(TTS_FRAME_BYTES * 3, 0x11));
    const session = makeDebugSession();
    vi.mocked(session.telnyxWs.send).mockImplementationOnce(() => {
      // L'appelant reprend la parole : barge-in.
      (session as unknown as { ttsGeneration: number }).ttsGeneration = 1;
    });

    await speakTtsStreamed(session, 'Je vous récapitule la réservation.');

    expect(vi.mocked(session.telnyxWs.send)).toHaveBeenCalledTimes(1);
    expect(spokenStatus(session)).toEqual(['interrupted']);
  });

  it('marque « non prononcée » une réplique jamais lue', async () => {
    vi.mocked(getTtsCached).mockResolvedValue(Buffer.alloc(TTS_FRAME_BYTES, 0x11));
    const session = makeDebugSession();

    const playback = speakTtsStreamed(session, 'Phrase jamais entendue.');
    (session as unknown as { ttsGeneration: number }).ttsGeneration = 1;
    await playback;

    expect(spokenStatus(session)).toEqual(['not_played']);
  });
});
