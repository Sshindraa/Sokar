import { describe, expect, it } from 'vitest';
import {
  isLiveStripeSecretKey,
  openRouterFallbackBaseUrlSchema,
  resolveSemanticModel,
  voiceSttBooleanFlagSchema,
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

describe('VOICE_DIALOGUE_LISTENING_V2 environment schema', () => {
  it('defaults to off and accepts only explicit boolean strings', () => {
    expect(voiceSttBooleanFlagSchema.parse(undefined)).toBe('false');
    expect(voiceSttBooleanFlagSchema.parse('true')).toBe('true');
    expect(voiceSttBooleanFlagSchema.parse('false')).toBe('false');
    expect(voiceSttBooleanFlagSchema.safeParse('1').success).toBe(false);
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
