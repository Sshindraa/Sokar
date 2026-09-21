import { describe, expect, it } from 'vitest';
import {
  GROQ_BASE_URL,
  VOICE_LLM_FALLBACK_MODEL_DEFAULT,
  VOICE_LLM_MODEL_DEFAULT,
} from '@sokar/config';
import { VoiceConfigSchema, optionalUrlSchema } from '../env';

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
      VOICE_LLM_PROVIDER: 'cerebras',
      VOICE_LLM_MODEL: VOICE_LLM_MODEL_DEFAULT,
      VOICE_LLM_FALLBACK_MODEL: VOICE_LLM_FALLBACK_MODEL_DEFAULT,
      VOICE_LLM_TIMEOUT_MS: 8000,
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      GROQ_BASE_URL,
    });
    expect(config.CEREBRAS_API_KEY).toBeUndefined();
    expect(config.OPENROUTER_API_KEY).toBeUndefined();
    expect(config.GROQ_API_KEY).toBeUndefined();
  });

  it('parse les overrides typés et conserve les clés API optionnelles', () => {
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_PROVIDER: 'openrouter',
      VOICE_LLM_MODEL: 'primary/test-model',
      VOICE_LLM_FALLBACK_MODEL: 'fallback/test-model',
      VOICE_LLM_TIMEOUT_MS: '1250',
      OPENROUTER_BASE_URL: 'https://router.example.test/v1',
      GROQ_BASE_URL: 'https://groq.example.test/openai/v1',
      CEREBRAS_API_KEY: 'csk',
      OPENROUTER_API_KEY: 'or-key',
      GROQ_API_KEY: 'gsk-key',
    });

    expect(config).toEqual({
      VOICE_LLM_PROVIDER: 'openrouter',
      VOICE_LLM_MODEL: 'primary/test-model',
      VOICE_LLM_FALLBACK_MODEL: 'fallback/test-model',
      VOICE_LLM_TIMEOUT_MS: 1250,
      OPENROUTER_BASE_URL: 'https://router.example.test/v1',
      GROQ_BASE_URL: 'https://groq.example.test/openai/v1',
      CEREBRAS_API_KEY: 'csk',
      OPENROUTER_API_KEY: 'or-key',
      GROQ_API_KEY: 'gsk-key',
    });
  });

  it('accepte Groq comme provider vocal', () => {
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_PROVIDER: 'groq',
      VOICE_LLM_MODEL: 'qwen/qwen3.8-27b',
      GROQ_API_KEY: 'gsk-key',
    });

    expect(config).toMatchObject({
      VOICE_LLM_PROVIDER: 'groq',
      VOICE_LLM_MODEL: 'qwen/qwen3.8-27b',
      GROQ_BASE_URL,
      GROQ_API_KEY: 'gsk-key',
    });
  });

  it('préserve les fallbacks historiques pour provider et timeout invalides', () => {
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_PROVIDER: 'legacy-provider',
      VOICE_LLM_TIMEOUT_MS: 'not-a-number',
    });

    expect(config.VOICE_LLM_PROVIDER).toBe('cerebras');
    expect(config.VOICE_LLM_TIMEOUT_MS).toBe(8000);
  });

  it('refuse une URL OpenRouter invalide', () => {
    const result = VoiceConfigSchema.safeParse({ OPENROUTER_BASE_URL: 'not-a-url' });

    expect(result.success).toBe(false);
  });
});
