import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/redis/client', () => ({ redisCache: {} }));

import {
  comparableWords,
  currentSecondOpinionNote,
  extractUtteranceWav,
  isSttSecondOpinionEnabled,
  recordSecondOpinionAudio,
  requestSecondOpinion,
  SECOND_OPINION_NOTE_TTL_MS,
  transcriptsDiffer,
} from '../stream/stt-second-opinion';
import {
  buildSecondOpinionBlock,
  buildStructuredTurnMessages,
} from '../stream/structured-turn/prompt';
import { createStructuredTurnState } from '../stream/structured-turn/fact-guards';
import type { CallSession } from '../stream/types';

const BYTES_PER_MS = 8; // Deepgram reçoit l'A-law brut à 8 kHz.

function session(overrides: Partial<CallSession> = {}): CallSession {
  return {
    callControlId: 'call-1',
    restaurantId: 'r1',
    codec: 'PCMA',
    sttAdapter: { id: 'deepgram' },
    sttSecondOpinionEnabled: true,
    ...overrides,
  } as unknown as CallSession;
}

function feed(target: CallSession, seconds: number, startByte = 0): number {
  let offset = startByte;
  for (let i = 0; i < seconds * 50; i++) {
    const frame = Buffer.alloc(160, 0xd5); // 20 ms d'A-law
    recordSecondOpinionAudio(target, frame, offset, BYTES_PER_MS);
    offset += frame.length;
  }
  return offset;
}

function spendStore(initial = 0) {
  const values = new Map<string, number>();
  return {
    values,
    get: vi.fn(async (key: string) => String(values.get(key) ?? initial)),
    incrbyfloat: vi.fn(async (key: string, by: number) =>
      values.set(key, (values.get(key) ?? initial) + by),
    ),
    expire: vi.fn(async () => 1),
  };
}

function completion(text: string, cost = 0.0003): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ text, usage: { cost } }),
  }) as unknown as typeof fetch;
}

const words = [{ word: 'je', start: 1.0, end: 1.2 }];
const env = { OPENROUTER_API_KEY: 'k' };

afterEach(() => {
  vi.clearAllMocks();
});

describe('réglage', () => {
  it('liste vide = aucun ; liste ou * = restaurants concernés', () => {
    expect(isSttSecondOpinionEnabled('r1', {})).toBe(false);
    expect(isSttSecondOpinionEnabled('r1', { VOICE_STT_SECOND_OPINION_RESTAURANT_IDS: 'r2' })).toBe(
      false,
    );
    expect(
      isSttSecondOpinionEnabled('r1', { VOICE_STT_SECOND_OPINION_RESTAURANT_IDS: 'r2,r1' }),
    ).toBe(true);
    expect(isSttSecondOpinionEnabled('r1', { VOICE_STT_SECOND_OPINION_RESTAURANT_IDS: '*' })).toBe(
      true,
    );
  });

  it("sans réglage, aucun audio n'est gardé", () => {
    const target = session({ sttSecondOpinionEnabled: undefined });
    recordSecondOpinionAudio(target, Buffer.alloc(160), 0, BYTES_PER_MS);
    expect(target.sttSecondOpinionAudio).toBeUndefined();
  });
});

describe('comparaison des transcriptions', () => {
  it('ignore casse, ponctuation et hésitations', () => {
    expect(comparableWords('Euh, Oui bonjour !')).toEqual(['oui', 'bonjour']);
    expect(transcriptsDiffer('Oui, bonjour.', 'euh oui bonjour')).toBe(false);
    expect(transcriptsDiffer('pour six personnes', 'pour dix personnes')).toBe(true);
  });
});

describe('tampon audio', () => {
  it('extrait la phrase en WAV 8 kHz avec les marges', () => {
    const target = session();
    feed(target, 5);
    const wav = extractUtteranceWav(target, 1000, 3000, BYTES_PER_MS);
    expect(wav?.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav?.readUInt32LE(24)).toBe(8000);
    // 2 s + 0,3 s avant + 0,3 s après, en PCM16 à 8 kHz.
    expect(wav?.length).toBe(44 + 2.6 * 8000 * 2);
  });

  it('ne garde que les 20 dernières secondes et repart de zéro après une reconnexion', () => {
    const target = session();
    feed(target, 30);
    expect(extractUtteranceWav(target, 2000, 4000, BYTES_PER_MS)).toBeNull();
    expect(extractUtteranceWav(target, 25_000, 27_000, BYTES_PER_MS)).not.toBeNull();
    recordSecondOpinionAudio(target, Buffer.alloc(160), 0, BYTES_PER_MS);
    expect(target.sttSecondOpinionAudio).toHaveLength(1);
  });

  it('décode le L16 sans conversion, à 16 kHz', () => {
    const target = session({ codec: 'L16' });
    recordSecondOpinionAudio(target, Buffer.alloc(32 * 3000), 0, 32);
    expect(extractUtteranceWav(target, 1000, 2000, 32)?.readUInt32LE(24)).toBe(16_000);
  });
});

describe('second avis en arrière-plan', () => {
  it("demande l'avis sur une phrase longue et note la différence pour le tour suivant", async () => {
    const target = session();
    feed(target, 5);
    const spend = spendStore();
    const fetcher = completion('je voudrais une table pour six personnes');
    await requestSecondOpinion(
      target,
      'je voudrais une table pour dix personnes',
      words,
      3000,
      BYTES_PER_MS,
      {
        fetcher,
        env,
        spend,
      },
    );
    const [url, init] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/audio/transcriptions');
    expect(JSON.parse(String((init as RequestInit).body)).model).toBe('microsoft/mai-transcribe-2');
    expect(target.sttSecondOpinionNote).toEqual(
      expect.objectContaining({
        heard: 'je voudrais une table pour dix personnes',
        secondHeard: 'je voudrais une table pour six personnes',
      }),
    );
    expect(spend.incrbyfloat).toHaveBeenCalledWith(
      expect.stringMatching(/^stt-second-opinion:usd:/),
      0.0003,
    );
  });

  it('aucune note quand les deux transcriptions concordent', async () => {
    const target = session();
    feed(target, 5);
    await requestSecondOpinion(
      target,
      'Je voudrais une table, euh, demain soir',
      words,
      3000,
      BYTES_PER_MS,
      {
        fetcher: completion('je voudrais une table demain soir'),
        env,
        spend: spendStore(),
      },
    );
    expect(target.sttSecondOpinionNote).toBeUndefined();
  });

  it('ne demande rien pour une phrase courte, hors Deepgram ou sans réglage', () => {
    const fetcher = completion('x');
    const target = session();
    feed(target, 5);
    expect(
      requestSecondOpinion(target, 'oui demain', words, 3000, BYTES_PER_MS, { fetcher, env }),
    ).toBeUndefined();
    expect(
      requestSecondOpinion(
        session({ sttAdapter: { id: 'scribe' } as never }),
        'je voudrais une table demain',
        words,
        3000,
        BYTES_PER_MS,
        { fetcher, env },
      ),
    ).toBeUndefined();
    expect(
      requestSecondOpinion(
        session({ sttSecondOpinionEnabled: false }),
        'je voudrais une table demain',
        words,
        3000,
        BYTES_PER_MS,
        { fetcher, env },
      ),
    ).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('respecte le plafond quotidien et le plafond par appel', async () => {
    const target = session();
    feed(target, 5);
    const fetcher = completion('autre chose entendu ici');
    await requestSecondOpinion(target, 'je voudrais une table demain', words, 3000, BYTES_PER_MS, {
      fetcher,
      env: { ...env, VOICE_STT_SECOND_OPINION_DAILY_USD: '0.5' },
      spend: spendStore(0.5),
    });
    expect(fetcher).not.toHaveBeenCalled();

    const busy = session({ sttSecondOpinionCount: 8 });
    feed(busy, 5);
    expect(
      requestSecondOpinion(busy, 'je voudrais une table demain', words, 3000, BYTES_PER_MS, {
        fetcher,
        env,
      }),
    ).toBeUndefined();
  });

  it('une erreur du fournisseur ne laisse aucune note et ne lève pas', async () => {
    const target = session();
    feed(target, 5);
    const fetcher = vi.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
    await expect(
      requestSecondOpinion(target, 'je voudrais une table demain', words, 3000, BYTES_PER_MS, {
        fetcher,
        env,
        spend: spendStore(),
      }),
    ).resolves.toBeUndefined();
    expect(target.sttSecondOpinionNote).toBeUndefined();
  });
});

describe('note du tour suivant', () => {
  it('expire après 90 s et disparaît une fois la réservation créée', () => {
    const now = 1_000_000;
    const target = session({ sttSecondOpinionNote: { heard: 'a', secondHeard: 'b', at: now } });
    expect(currentSecondOpinionNote(target, false, now + 1000)).toBeDefined();
    expect(currentSecondOpinionNote(target, true, now + 1000)).toBeUndefined();
    expect(
      currentSecondOpinionNote(target, false, now + SECOND_OPINION_NOTE_TTL_MS + 1),
    ).toBeUndefined();
  });

  it('entre dans le prompt comme un principe, sans phrase imposée', () => {
    const block = buildSecondOpinionBlock({
      heard: 'pour dix personnes',
      secondHeard: 'pour six personnes',
    });
    expect(block).toContain('SECONDE ÉCOUTE');
    expect(block).toContain('"pour dix personnes"');
    expect(block).toContain('vérifie-la avec l');
    expect(block).toContain('Ne parle jamais de cette seconde écoute');
    const state = createStructuredTurnState();
    const withNote = buildStructuredTurnMessages({
      systemPrompt: 'base',
      history: [],
      transcript: 'oui',
      state,
      secondOpinion: { heard: 'pour dix personnes', secondHeard: 'pour six personnes' },
    });
    const without = buildStructuredTurnMessages({
      systemPrompt: 'base',
      history: [],
      transcript: 'oui',
      state,
    });
    expect(String(withNote[0].content)).toContain('SECONDE ÉCOUTE');
    expect(String(without[0].content)).not.toContain('SECONDE ÉCOUTE');
  });
});
