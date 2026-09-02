import { describe, expect, it } from 'vitest';
import { VOICE_LLM_FALLBACK_MODEL_DEFAULT, VOICE_LLM_MODEL_DEFAULT } from '@sokar/config';
import { VoiceConfigSchema } from '../env';

describe('VoiceConfigSchema', () => {
  it('conserve les valeurs par défaut du pipeline voice', () => {
    const config = VoiceConfigSchema.parse({});

    expect(config).toMatchObject({
      VOICE_LLM_PROVIDER: 'cerebras',
      VOICE_LLM_MODEL: VOICE_LLM_MODEL_DEFAULT,
      VOICE_LLM_FALLBACK_MODEL: VOICE_LLM_FALLBACK_MODEL_DEFAULT,
      VOICE_LLM_TIMEOUT_MS: 8000,
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    });
    expect(config.CEREBRAS_API_KEY).toBeUndefined();
    expect(config.OPENROUTER_API_KEY).toBeUndefined();
  });

  it('parse les overrides typés et conserve les clés API optionnelles', () => {
    const config = VoiceConfigSchema.parse({
      VOICE_LLM_PROVIDER: 'openrouter',
      VOICE_LLM_MODEL: 'primary/test-model',
      VOICE_LLM_FALLBACK_MODEL: 'fallback/test-model',
      VOICE_LLM_TIMEOUT_MS: '1250',
      OPENROUTER_BASE_URL: 'https://router.example.test/v1',
      CEREBRAS_API_KEY: 'csk',
      OPENROUTER_API_KEY: 'or-key',
    });

    expect(config).toEqual({
      VOICE_LLM_PROVIDER: 'openrouter',
      VOICE_LLM_MODEL: 'primary/test-model',
      VOICE_LLM_FALLBACK_MODEL: 'fallback/test-model',
      VOICE_LLM_TIMEOUT_MS: 1250,
      OPENROUTER_BASE_URL: 'https://router.example.test/v1',
      CEREBRAS_API_KEY: 'csk',
      OPENROUTER_API_KEY: 'or-key',
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
