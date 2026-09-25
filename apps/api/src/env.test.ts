import { describe, expect, it } from 'vitest';
import { isLiveStripeSecretKey, voiceSttBooleanFlagSchema } from './env';

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
