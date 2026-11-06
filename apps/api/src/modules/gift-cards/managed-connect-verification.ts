import { getAuth } from '@clerk/fastify';
import type { FastifyRequest } from 'fastify';

export function managedConnectVerified(req: FastifyRequest): boolean {
  // The staging demonstration has no Clerk session and can only use Stripe test keys.
  if (
    process.env.DEMO_STAGING === '1' &&
    process.env.DEMO_RESTAURANT_ID &&
    process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') &&
    process.env.STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_')
  )
    return true;
  try {
    return getAuth(req).has?.({ reverification: 'strict' }) === true;
  } catch {
    return false;
  }
}

export const managedConnectVerificationRequired = {
  clerk_error: {
    type: 'forbidden',
    reason: 'reverification-error',
    metadata: { reverification: 'strict' },
  },
};
