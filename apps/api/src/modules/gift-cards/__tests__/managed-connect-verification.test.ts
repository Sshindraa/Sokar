import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { managedConnectVerified } from '../managed-connect-verification';

const auth = vi.hoisted(() => vi.fn());
vi.mock('@clerk/fastify', () => ({ getAuth: auth }));
const req = {} as FastifyRequest;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

describe('managed Connect reverification', () => {
  it('requires a recent verified Clerk session and fails closed', () => {
    vi.stubEnv('DEMO_STAGING', '');
    auth.mockReturnValue({ has: vi.fn().mockReturnValue(true) });
    expect(managedConnectVerified(req)).toBe(true);
    expect(auth.mock.results[0].value.has).toHaveBeenCalledWith({ reverification: 'strict' });
    auth.mockReturnValue({ has: () => false });
    expect(managedConnectVerified(req)).toBe(false);
    auth.mockImplementation(() => {
      throw new Error('missing session');
    });
    expect(managedConnectVerified(req)).toBe(false);
  });

  it('allows the unauthenticated demonstration only with test keys', () => {
    vi.stubEnv('DEMO_STAGING', '1');
    vi.stubEnv('DEMO_RESTAURANT_ID', 'demo');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_example');
    vi.stubEnv('STRIPE_PUBLISHABLE_KEY', 'pk_test_example');
    expect(managedConnectVerified(req)).toBe(true);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_example');
    expect(managedConnectVerified(req)).toBe(false);
  });
});
