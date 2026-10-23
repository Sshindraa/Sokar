import { describe, expect, it } from 'vitest';
import {
  hasElevenLabsTtsConfig,
  hasSttProviderKey,
  isLiveStripeSecretKey,
  openRouterFallbackBaseUrlSchema,
  resolveSemanticModel,
} from './env';

describe('Stripe environment guard', () => {
  it('recognises live secret keys without exposing their value', () => {
    expect(isLiveStripeSecretKey('sk_live_example')).toBe(true);
    expect(isLiveStripeSecretKey('  sk_live_example  ')).toBe(true);
  });

  it('allows test, missing and unrelated values', () => {
    expect(isLiveStripeSecretKey('sk_test_example')).toBe(false);
    expect(isLiveStripeSecretKey(undefined)).toBe(false);
    expect(isLiveStripeSecretKey('')).toBe(false);
  });
});

describe('OPENROUTER_FALLBACK_BASE_URL environment schema', () => {
  it('is absent by default and treats an empty .env line as absent', () => {
    expect(openRouterFallbackBaseUrlSchema.parse(undefined)).toBeUndefined();
    expect(openRouterFallbackBaseUrlSchema.parse('')).toBeUndefined();
    expect(openRouterFallbackBaseUrlSchema.parse('   ')).toBeUndefined();
  });

  it('accepts a URL and rejects anything else', () => {
    expect(openRouterFallbackBaseUrlSchema.parse('https://eu.openrouter.ai/api/v1')).toBe(
      'https://eu.openrouter.ai/api/v1',
    );
    expect(openRouterFallbackBaseUrlSchema.safeParse('eu.openrouter.ai').success).toBe(false);
  });
});

describe('Span-01 model resolution', () => {
  it('falls back to the provider default, including for an empty value', () => {
    expect(resolveSemanticModel('openrouter', undefined)).toBe('typesafe/jev-1.13-20260917');
    expect(resolveSemanticModel('openrouter', '')).toBe('typesafe/jev-1.13-20260917');
    expect(resolveSemanticModel('respan', undefined)).toBe('span-01-pro');
    expect(resolveSemanticModel('respan', '')).toBe('span-01-pro');
  });

  it('keeps provider-specific models and rejects cross-provider values', () => {
    expect(resolveSemanticModel('respan', 'span-01-free')).toBe('span-01-free');
    expect(resolveSemanticModel('openrouter', 'typesafe/jev-1.13-20260917')).toBe(
      'typesafe/jev-1.13-20260917',
    );
    expect(resolveSemanticModel('openrouter', 'typesafe/jev-latest')).toBe('typesafe/jev-latest');
    expect(() => resolveSemanticModel('openrouter', 'span-01-pro')).toThrow(/appartient à Respan/);
    expect(() => resolveSemanticModel('respan', 'typesafe/jev-1.13-20260917')).toThrow(
      /n'est pas un modèle Respan/,
    );
  });
});

describe('clé de reconnaissance vocale en production', () => {
  const key = 'k'.repeat(24);

  it('exige la clé Deepgram, seul fournisseur de reconnaissance : aucune clé ElevenLabs', () => {
    expect(hasSttProviderKey({ DEEPGRAM_API_KEY: key })).toBe(true);
    expect(hasSttProviderKey({ DEEPGRAM_API_KEY: 'court' })).toBe(false);
    expect(hasSttProviderKey({})).toBe(false);
  });
});

describe('synthèse ElevenLabs du téléphone en production', () => {
  const key = 'k'.repeat(24);

  it('sans bascule, aucune exigence ElevenLabs', () => {
    expect(hasElevenLabsTtsConfig({ VOICE_TTS_PROVIDER: 'cartesia' })).toBe(true);
  });

  it('avec ElevenLabs, la clé (≥20 caractères) et la voix sont exigées', () => {
    expect(
      hasElevenLabsTtsConfig({
        VOICE_TTS_PROVIDER: 'elevenlabs',
        ELEVENLABS_API_KEY: key,
        ELEVENLABS_TTS_VOICE_ID: 'voix',
      }),
    ).toBe(true);
    expect(
      hasElevenLabsTtsConfig({ VOICE_TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: key }),
    ).toBe(false);
    expect(
      hasElevenLabsTtsConfig({
        VOICE_TTS_PROVIDER: 'elevenlabs',
        ELEVENLABS_API_KEY: 'court',
        ELEVENLABS_TTS_VOICE_ID: 'voix',
      }),
    ).toBe(false);
  });
});
