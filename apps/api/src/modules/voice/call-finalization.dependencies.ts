import type { FastifyInstance } from 'fastify';
import { RestaurantService } from '../restaurants/restaurant.service';
import { sanitizeJobId } from '../../shared/queue/job-options';
import type { CallFinalizationDependencies } from './call-finalization.service';
import type { CallRecoveryDispatchInput } from './call-finalization.service';

function buildRecoveryJobId(callLegId: string): string {
  return sanitizeJobId(`recovery_${callLegId}`);
}

/**
 * Dépendances communes aux chemins webhook et WebSocket : même contexte
 * restaurant et même enqueue idempotent de récupération commerciale.
 */
export function callFinalizationDependencies(app: FastifyInstance): CallFinalizationDependencies {
  return {
    db: app.db,
    loadRestaurantContext: async (toNumber) => {
      const context = await RestaurantService.loadContext(toNumber);
      return {
        id: context.id,
        name: context.name,
        slug: context.slug ?? null,
        phoneNumber: context.phoneNumber ?? null,
      };
    },
    enqueueRecovery: async (input: CallRecoveryDispatchInput, callLegId: string): Promise<void> => {
      const customer = await app.db.customer.findFirst({
        where: { restaurantId: input.restaurantId, phone: input.customerPhone },
        select: { name: true },
      });
      await app.queues.callRecovery.add(
        'send-recovery-sms',
        { ...input, customerName: customer?.name ?? input.customerName },
        { jobId: buildRecoveryJobId(callLegId) },
      );
    },
  };
}
