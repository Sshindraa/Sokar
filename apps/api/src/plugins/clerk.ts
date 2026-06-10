import { clerkPlugin, getAuth } from '@clerk/fastify';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export function isClerkConfigured() {
  return Boolean(process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export async function registerClerk(app: FastifyInstance) {
  if (!isClerkConfigured()) {
    app.log.warn('Clerk is not configured; protected API routes will return 503');
    return;
  }

  await app.register(clerkPlugin, {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY as string,
    secretKey: process.env.CLERK_SECRET_KEY as string,
  });
}

/**
 * Middleware qui exige une organisation (restaurant).
 * Injecte restaurantId (= orgId) et userId dans la requête.
 */
export function requireOrg() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isClerkConfigured()) {
      return reply.status(503).send({ error: 'Authentication provider not configured' });
    }

    const { orgId, userId } = getAuth(req);
    if (!orgId) {
      return reply.status(401).send({ error: 'Organization required' });
    }
    req.restaurantId = orgId;
    req.userId = userId;
  };
}

/**
 * Middleware qui exige une session utilisateur (login simple sans org).
 */
export function requireAuth() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!isClerkConfigured()) {
      return reply.status(503).send({ error: 'Authentication provider not configured' });
    }

    const { userId } = getAuth(req);
    if (!userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    req.userId = userId;
  };
}
