import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EntitlementCapability } from '@sokar/config';
import { evaluateCapability } from './entitlement.service';

/** Server-side commercial guard. Runtime flags and provider health are checked separately. */
export function requireCapability(capability: EntitlementCapability) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const decision = await evaluateCapability(request.restaurantId, capability);
    if (!decision.allowed) {
      return reply.status(403).send({
        error: 'CAPABILITY_NOT_INCLUDED',
        message: 'Cette fonctionnalité n’est pas incluse dans votre formule.',
        capability,
        plan: decision.plan,
      });
    }
  };
}
