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
 *
 * Logging: replaces the request's child logger with one enriched with
 * `restaurant_id` and `user_id`. Every subsequent `req.log.info(...)`
 * in the handler chain (and any DB/service call that uses the request
 * logger) automatically carries these bindings, which makes it
 * straightforward to filter production logs per tenant or per user
 * when debugging a 5xx reported by a specific restaurant.
 */
export function requireOrg() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Staging demo mode : pas de session requise, on injecte le restaurant démo.
    // DEMO_STAGING n'est défini qu'en staging → la prod reste inchangée.
    const demoMode = process.env.NODE_ENV !== 'production' || process.env.DEMO_STAGING === '1';
    if (demoMode && process.env.DEMO_RESTAURANT_ID) {
      req.restaurantId = process.env.DEMO_RESTAURANT_ID;
      req.userId = process.env.DEMO_USER_ID ?? 'demo-user';
      req.log = req.log.child({
        restaurant_id: req.restaurantId,
        user_id: req.userId,
      });
      return;
    }

    if (!isClerkConfigured()) {
      return reply.status(503).send({ error: 'Authentication provider not configured' });
    }

    const { orgId, userId } = getAuth(req);
    if (!orgId) {
      return reply.status(401).send({ error: 'Organization required' });
    }
    req.restaurantId = orgId;
    req.userId = userId;
    // Re-bind req.log to a child logger that carries restaurant + user.
    // We keep request_id (already on the parent) by chaining .child().
    req.log = req.log.child({ restaurant_id: orgId, user_id: userId ?? null });
  };
}

/**
 * Middleware qui exige une session utilisateur (login simple sans org).
 */
export function requireAuth() {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Staging demo mode : voir requireOrg(). DEMO_STAGING isolé à la staging.
    const demoMode = process.env.NODE_ENV !== 'production' || process.env.DEMO_STAGING === '1';
    if (demoMode && process.env.DEMO_RESTAURANT_ID) {
      req.userId = process.env.DEMO_USER_ID ?? 'demo-user';
      req.log = req.log.child({ user_id: req.userId });
      return;
    }

    if (!isClerkConfigured()) {
      return reply.status(503).send({ error: 'Authentication provider not configured' });
    }

    const { userId } = getAuth(req);
    if (!userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    req.userId = userId;
    req.log = req.log.child({ user_id: userId });
  };
}
