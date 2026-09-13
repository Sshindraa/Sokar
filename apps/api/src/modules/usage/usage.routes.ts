import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { getEffectiveEntitlements } from '../entitlements/entitlement.service';
import {
  currentMonthKey,
  getCurrentUsage,
  getUsageHistory,
  UsageInputError,
} from './usage.service';

const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const HistoryQuerySchema = z.object({ from: MonthSchema, to: MonthSchema });

export async function usageRoutes(app: FastifyInstance) {
  app.get('/usage/current', { preHandler: requireOrg() }, async (request, reply) => {
    const restaurantId = request.restaurantId;
    const month = currentMonthKey();
    const [usage, entitlements] = await Promise.all([
      getCurrentUsage(restaurantId, month),
      getEffectiveEntitlements(restaurantId),
    ]);

    return reply.send({
      month,
      usage,
      included: {
        voiceMinutes: entitlements.limits.voiceMinutesMonthly,
        smsSegments: entitlements.limits.smsMonthly,
      },
      limitsEnforced: {
        voiceMinutes: entitlements.limits.voiceMinutesMonthly !== null,
        smsSegments: entitlements.limits.smsMonthly !== null,
      },
    });
  });

  app.get('/usage/history', { preHandler: requireOrg() }, async (request, reply) => {
    const query = HistoryQuerySchema.parse(request.query);
    try {
      return reply.send({
        from: query.from,
        to: query.to,
        months: await getUsageHistory(request.restaurantId, query.from, query.to),
      });
    } catch (error) {
      if (error instanceof UsageInputError) {
        return reply.status(400).send({ error: error.code, message: error.message });
      }
      throw error;
    }
  });
}
