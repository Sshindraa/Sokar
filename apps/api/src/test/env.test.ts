import { describe, expect, it } from 'vitest';
import { CEREBRAS_BASE_URL, GROQ_BASE_URL, VOICE_LLM_MODEL_DEFAULT } from '@sokar/config';
import { VoiceConfigSchema, VoiceDeepgramConfigSchema, optionalUrlSchema } from '../env';

/**
 * Incident du 2026-09-22 : `pm2` transmet à ses process l'environnement du
 * shell qui l'a lancé, donc un secret de workflow non renseigné arrive en
 * chaîne vide. `.optional()` ne protège pas dans ce cas, et le process de
 * workers bouclait en crash — bloquant toute promotion staging → production.
 */
describe('optionalUrlSchema', () => {
  it('traite une variable absente comme non configurée', () => {
    expect(optionalUrlSchema.parse(undefined)).toBeUndefined();
  });

  it('traite une variable vide comme non configurée', () => {
    expect(optionalUrlSchema.parse('')).toBeUndefined();
    expect(optionalUrlSchema.parse('   ')).toBeUndefined();
  });

  it('accepte une URL valide et retire les espaces', () => {
    expect(optionalUrlSchema.parse('  https://hooks.example.test/T1  ')).toBe(
      'https://hooks.example.test/T1',
    );
  });

  it('refuse une valeur non vide qui n’est pas une URL', () => {
    expect(optionalUrlSchema.safeParse('pas-une-url').success).toBe(false);
    expect(optionalUrlSchema.safeParse('hooks.example.test').success).toBe(false);
  });
});

describe('VoiceConfigSchema', () => {
  it('conserve les valeurs par défaut du pipeline voice', () => {
    const config = VoiceConfigSchema.parse({});

    expect(config).toMatchObject({
      VOICE_LLM_MODEL: VOICE_LLM_MODEL_DEFAULT,
      VOICE_LLM_TIMEOUT_MS: 8000,
      VOICE_LLM_HEDGE_DELAY_MS: 1000,
      VOICE_LLM_HEDGE_TIMEOUT_MS: 3000,
      VOICE_LLM_HEDGE_MODEL: 'qwen/qwen3.8-27b',
      VOICE_LLM_FILLER_DELAY_MS: 1200,
      VOICE_DEEPGRAM_ENDPOINTING_MS: 300,
      VOICE_DEEPGRAM_UTTERANCE_END_MS: 1000,
      VOICE_DEEPGRAM_SPELLING_SILENCE_MS: 800,
      VOICE_DEEPGRAM_NUMERALS: 'true',
      VOICE_DEEPGRAM_PUNCTUATE: 'false',
      VOICE_DEEPGRAM_MIP_OPT_OUT: 'true',
      GROQ_BASE_URL,
    });
    expect(config.GROQ_API_KEY).toBeUndefined();
  });

  it('parse les overrides typés et conserve la clé API optionnelle', () => {
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_MODEL: 'qwen/qwen3.8-27b',
      VOICE_LLM_TIMEOUT_MS: '1250',
      GROQ_BASE_URL: 'https://groq.example.test/openai/v1',
      GROQ_API_KEY: 'gsk-key',
    });

    expect(config).toMatchObject({
      VOICE_LLM_MODEL: 'qwen/qwen3.8-27b',
      VOICE_LLM_TIMEOUT_MS: 1250,
      VOICE_LLM_PROVIDER: 'groq',
      GROQ_BASE_URL: 'https://groq.example.test/openai/v1',
      GROQ_API_KEY: 'gsk-key',
      CEREBRAS_BASE_URL,
    });
  });

  it('sélectionne Cerebras quand VOICE_LLM_PROVIDER le demande', () => {
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_PROVIDER: 'cerebras',
      VOICE_LLM_MODEL: 'qwen-3.8-27b',
      CEREBRAS_API_KEY: 'csk-key',
    });

    expect(config).toMatchObject({
      VOICE_LLM_PROVIDER: 'cerebras',
      VOICE_LLM_MODEL: 'qwen-3.8-27b',
      CEREBRAS_BASE_URL,
      CEREBRAS_API_KEY: 'csk-key',
    });
  });

  it('refuse un provider vocal inconnu', () => {
    expect(VoiceConfigSchema.safeParse({ VOICE_LLM_PROVIDER: 'legacy' }).success).toBe(false);
  });

  it('ignore les variables des providers supprimés', () => {
    // Les anciennes variables de routage ne doivent plus entrer dans la
    // configuration validée, même si elles traînent encore dans un .env.
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_FALLBACK_MODEL: 'legacy-model',
      VOICE_LLM_BASE_URL: 'https://legacy.example.test',
      VOICE_LLM_API_KEY: 'x',
      OPENROUTER_API_KEY: 'or-key',
    });

    expect(config).toMatchObject({
      VOICE_LLM_MODEL: VOICE_LLM_MODEL_DEFAULT,
      VOICE_LLM_TIMEOUT_MS: 8000,
      VOICE_LLM_PROVIDER: 'groq',
      GROQ_BASE_URL,
      CEREBRAS_BASE_URL,
    });
  });

  it('retombe sur le timeout par défaut si la valeur est invalide', () => {
    const config = VoiceConfigSchema.parse({ VOICE_LLM_TIMEOUT_MS: 'not-a-number' });

    expect(config.VOICE_LLM_TIMEOUT_MS).toBe(8000);
  });

  it('refuse une URL Groq invalide', () => {
    const result = VoiceConfigSchema.safeParse({ GROQ_BASE_URL: 'not-a-url' });

    expect(result.success).toBe(false);
  });

  it.each(['30', '2001'])('rejette endpointing Deepgram invalide (%s)', (value) => {
    expect(
      VoiceDeepgramConfigSchema.safeParse({ VOICE_DEEPGRAM_ENDPOINTING_MS: value }).success,
    ).toBe(false);
  });

  it('rejette un silence d’épellation hors limites', () => {
    expect(
      VoiceDeepgramConfigSchema.safeParse({ VOICE_DEEPGRAM_SPELLING_SILENCE_MS: '300' }).success,
    ).toBe(false);
  });

  it('utilise Nova par défaut et refuse un modèle Flux non documenté', () => {
    expect(VoiceDeepgramConfigSchema.parse({}).VOICE_DEEPGRAM_MODEL).toBe('nova-3');
    expect(VoiceDeepgramConfigSchema.parse({}).VOICE_DEEPGRAM_NUMERALS).toBe('true');
    expect(VoiceDeepgramConfigSchema.parse({}).VOICE_DEEPGRAM_PUNCTUATE).toBe('false');
    expect(VoiceDeepgramConfigSchema.parse({}).VOICE_DEEPGRAM_MIP_OPT_OUT).toBe('true');
    expect(VoiceDeepgramConfigSchema.safeParse({ VOICE_DEEPGRAM_MIP_OPT_OUT: 'yes' }).success).toBe(
      false,
    );
    expect(VoiceDeepgramConfigSchema.safeParse({ VOICE_DEEPGRAM_NUMERALS: 'on' }).success).toBe(
      false,
    );
    expect(
      VoiceDeepgramConfigSchema.safeParse({ VOICE_DEEPGRAM_MODEL: 'flux-general-en' }).success,
    ).toBe(false);
    expect(
      VoiceDeepgramConfigSchema.safeParse({ VOICE_DEEPGRAM_MODEL: 'flux-unknown' }).success,
    ).toBe(false);
  });
});
