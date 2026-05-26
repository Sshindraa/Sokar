import { clerkPlugin, getAuth } from '@clerk/fastify';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

export async function registerClerk(app: FastifyInstance) {
  await app.register(clerkPlugin, {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!,
    secretKey: process.env.CLERK_SECRET_KEY!,
  });
}

/**
 * Middleware qui exige une organisation (restaurant).
 * Injecte restaurantId (= orgId) et userId dans la requête.
 */
export function requireOrg() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
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
    const { userId } = getAuth(req);
    if (!userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    req.userId = userId;
  };
}
