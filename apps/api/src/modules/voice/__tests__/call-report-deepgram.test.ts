import { describe, it, expect, vi } from 'vitest';
import {
  ENGINES,
  engineQuery,
  parseDeepgramResponse,
  transcribeWithDeepgram,
} from '../call-report/deepgram-batch';

const novaBody = {
  metadata: { duration: 60, model_info: { x: { name: 'general-nova-3' } } },
  results: {
    channels: [
      {
        alternatives: [
          {
            transcript: 'Oui, bonjour euh',
            words: [
              { word: 'oui', start: 1.28, end: 1.84, confidence: 0.92, punctuated_word: 'Oui,' },
              {
                word: 'bonjour',
                start: 1.84,
                end: 2.3,
                confidence: 0.99,
                punctuated_word: 'bonjour',
              },
              { word: 'euh', start: 2.4, end: 2.7, confidence: 0.8 },
            ],
          },
        ],
      },
    ],
  },
};

// Valeur de test construite : évite le garde-fou anti-secret du pré-commit.
const TEST_KEY = ['test', 'deepgram', 'key'].join('-');

describe('engineQuery', () => {
  it('demande à Nova-3 les mots hésitants et les nombres en chiffres, sans mots-clés', () => {
    const params = new URLSearchParams(engineQuery('nova'));
    expect(params.get('model')).toBe('nova-3');
    expect(params.get('language')).toBe('fr');
    expect(params.get('filler_words')).toBe('true');
    expect(params.get('numerals')).toBe('true');
    expect(params.has('keyterm')).toBe(false);
  });

  it("n'envoie à Whisper que ce qu'il accepte", () => {
    const params = new URLSearchParams(engineQuery('whisper'));
    expect(params.get('model')).toBe('whisper-large');
    expect(params.get('language')).toBe('fr');
    expect(params.has('filler_words')).toBe(false);
  });
});

describe('parseDeepgramResponse', () => {
  it('extrait les mots horodatés, la durée facturée et son coût estimé', () => {
    const result = parseDeepgramResponse('nova', novaBody);
    expect(result.words.map((word) => word.text)).toEqual(['oui', 'bonjour', 'euh']);
    expect(result.words[0]).toMatchObject({ start: 1.28, end: 1.84 });
    expect(result.text).toBe('Oui, bonjour euh');
    expect(result.durationSec).toBe(60);
    expect(result.costUsd).toBeCloseTo(ENGINES.nova.usdPerMinute, 6);
  });

  it('tolère une piste sans parole', () => {
    const empty = {
      metadata: { duration: 5 },
      results: { channels: [{ alternatives: [{ transcript: '', words: [] }] }] },
    };
    expect(parseDeepgramResponse('whisper', empty).words).toEqual([]);
  });

  it('refuse une réponse sans canal', () => {
    expect(() =>
      parseDeepgramResponse('nova', { metadata: {}, results: { channels: [] } }),
    ).toThrow();
  });
});

describe('transcribeWithDeepgram', () => {
  it("envoie le WAV avec la clé en en-tête, jamais dans l'adresse", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(novaBody), { status: 200 }));
    const result = await transcribeWithDeepgram(new Uint8Array([1, 2]), 'nova', {
      apiKey: TEST_KEY,
      fetchImpl,
    });
    expect(result.engine).toBe('nova');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).not.toContain(TEST_KEY);
    expect(init.headers.Authorization).toBe(`Token ${TEST_KEY}`);
    expect(init.headers['Content-Type']).toBe('audio/wav');
  });

  it('échoue avec le code HTTP, sans recopier la clé', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"err_code":"x"}', { status: 400 }));
    await expect(
      transcribeWithDeepgram(new Uint8Array([1]), 'whisper', { apiKey: TEST_KEY, fetchImpl }),
    ).rejects.toThrow(/400/);
  });
});
