import { FastifyInstance, FastifyRequest } from 'fastify';
import rateLimitPlugin from '@fastify/rate-limit';
import { getAuth } from '@clerk/fastify';
import { redisCache } from '../shared/redis/client';
import {
  RATE_LIMIT_GLOBAL_MAX,
  RATE_LIMIT_INTERNAL_READ_MAX,
  RATE_LIMIT_USER_READ_MAX,
  RATE_LIMIT_USER_WRITE_MAX,
  RATE_LIMIT_WINDOW,
} from './rate-limit.policy';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function authenticatedUserId(req: FastifyRequest): string | null {
  try {
    return getAuth(req).userId ?? null;
  } catch {
    // Clerk absent (tests, Clerk non configuré) : on retombe sur le budget par IP.
    return null;
  }
}

/**
 * Budget du limiteur global pour une requête.
 * Un utilisateur Clerk a son propre compteur, séparé entre lectures et actions : plusieurs postes
 * derrière le même routeur ne se partagent plus 100 req/min, et le polling ne bloque pas un clic.
 * Le trafic anonyme garde le budget par IP.
 */
export function rateLimitBucket(req: FastifyRequest): { key: string; max: number } {
  const userId = authenticatedUserId(req);
  if (!userId) return { key: `ip:${req.ip}`, max: RATE_LIMIT_GLOBAL_MAX };
  return READ_METHODS.has(req.method)
    ? { key: `user:${userId}:read`, max: RATE_LIMIT_USER_READ_MAX }
    : { key: `user:${userId}:write`, max: RATE_LIMIT_USER_WRITE_MAX };
}

const LOOPBACK_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Plafond d'une lecture publique que Connect appelle côté serveur : le trafic loopback (rendu
 * serveur de Connect, sans X-Forwarded-For) a son propre budget, les visiteurs gardent `max`.
 */
export function publicReadMax(max: number) {
  return (req: FastifyRequest) => (LOOPBACK_IPS.has(req.ip) ? RATE_LIMIT_INTERNAL_READ_MAX : max);
}

/**
 * Global rate limit, applied to every route.
 *
 * Sensitive public surfaces override it with a stricter or more permissive
 * budget declared at the route level — see `rate-limit.policy.ts` for the
 * tiers and their rationale. Provider webhooks in particular must not inherit
 * this 100 req/min budget.
 *
 * The limiter hook is route-level `onRequest`; Clerk authenticates in a root
 * `onRequest` hook (see `clerk.ts`), which runs first, so the session is known
 * when the bucket is chosen and before any `requireOrg()` database work.
 */
export async function registerRateLimit(app: FastifyInstance) {
  await app.register(rateLimitPlugin, {
    ...(process.env.NODE_ENV === 'test' ? {} : { redis: redisCache }),
    max: (req) => rateLimitBucket(req).max,
    keyGenerator: (req) => rateLimitBucket(req).key,
    timeWindow: RATE_LIMIT_WINDOW,
  });
}
