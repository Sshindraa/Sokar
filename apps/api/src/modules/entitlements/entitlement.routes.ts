import type { FastifyInstance } from 'fastify';
import { requireOrg } from '../../plugins/clerk';
import {
  EntitlementPlanInvalidError,
  EntitlementRestaurantNotFoundError,
  getEffectiveEntitlements,
} from './entitlement.service';

export async function entitlementRoutes(app: FastifyInstance) {
  app.get('/entitlements', { preHandler: requireOrg() }, async (request, reply) => {
    try {
      return reply.send(await getEffectiveEntitlements(request.restaurantId));
    } catch (error) {
      if (error instanceof EntitlementRestaurantNotFoundError) {
        return reply.status(404).send({ error: error.code, message: 'Restaurant introuvable.' });
      }
      if (error instanceof EntitlementPlanInvalidError) {
        request.log.error({ sourcePlan: error.sourcePlan }, 'Unsupported entitlement plan');
        return reply.status(500).send({
          error: error.code,
          message: 'La formule du restaurant ne peut pas être évaluée.',
        });
      }
      throw error;
    }
  });
}
