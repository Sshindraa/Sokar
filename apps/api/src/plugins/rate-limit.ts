import { FastifyInstance } from 'fastify';
import rateLimitPlugin from '@fastify/rate-limit';
import { RATE_LIMIT_GLOBAL_MAX, RATE_LIMIT_WINDOW } from './rate-limit.policy';

/**
 * Global rate limit, applied to every route.
 *
 * Sensitive public surfaces override it with a stricter or more permissive
 * budget declared at the route level — see `rate-limit.policy.ts` for the
 * tiers and their rationale. Provider webhooks in particular must not inherit
 * this 100 req/min budget.
 */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimitPlugin, {
    max: RATE_LIMIT_GLOBAL_MAX,
    timeWindow: RATE_LIMIT_WINDOW,
  });
}
