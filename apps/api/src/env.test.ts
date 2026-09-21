import { describe, expect, it } from 'vitest';
import { isLiveStripeSecretKey } from './env';

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
