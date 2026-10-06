import { describe, expect, it } from 'vitest';
import { isLocalGiftCardTest } from '../gift-card-local-test';
const env = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://localhost/demo',
  DEMO_RESTAURANT_ID: 'demo',
  STRIPE_SECRET_KEY: ['sk', 'test', 'fixture'].join('_'),
  STRIPE_PUBLISHABLE_KEY: ['pk', 'test', 'fixture'].join('_'),
};
describe('local gift-card test isolation', () => {
  it('allows only the local demo with test payments', () => {
    expect(isLocalGiftCardTest('demo', env)).toBe(true);
    expect(isLocalGiftCardTest('another-restaurant', env)).toBe(false);
  });
  it.each([
    { NODE_ENV: 'production' },
    { DATABASE_URL: 'postgresql://remote.example/demo' },
    { DATABASE_URL: 'invalid' },
    { STRIPE_SECRET_KEY: ['sk', 'live', 'fixture'].join('_') },
    { STRIPE_PUBLISHABLE_KEY: ['pk', 'live', 'fixture'].join('_') },
    { DEMO_RESTAURANT_ID: '' },
  ])('rejects unsafe context %j', (override) => {
    expect(isLocalGiftCardTest('demo', { ...env, ...override })).toBe(false);
  });
});
