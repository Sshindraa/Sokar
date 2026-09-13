import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { getEffectiveEntitlements } from '../entitlements/entitlement.service';
import {
  currentMonthKey,
  getCurrentUsage,
  getUsageHistory,
  UsageInputError,
} from './usage.service';
import { buildUsageQuotaSnapshot } from './usage-quota.service';
import { getInternalUsageSummary } from './usage-internal.service';

const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const HistoryQuerySchema = z.object({ from: MonthSchema, to: MonthSchema });
const InternalUsageQuerySchema = z.object({
  month: MonthSchema.optional(),
  restaurantId: z.string().trim().min(1).max(128).optional(),
});

async function requireInternalUsageToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  const expected = process.env.SOKAR_INTERNAL_USAGE_TOKEN?.trim();
  if (!expected) {
    return reply.status(503).send({ error: 'INTERNAL_USAGE_TOKEN_NOT_CONFIGURED' });
  }
  const suppliedHeader = request.headers['x-sokar-internal-usage-token'];
  const supplied = Array.isArray(suppliedHeader) ? suppliedHeader[0] : suppliedHeader;
  if (!supplied) return reply.status(401).send({ error: 'INTERNAL_USAGE_UNAUTHORIZED' });
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return reply.status(401).send({ error: 'INTERNAL_USAGE_UNAUTHORIZED' });
  }
}

export async function usageRoutes(app: FastifyInstance) {
  app.get('/usage/current', { preHandler: requireOrg() }, async (request, reply) => {
    const restaurantId = request.restaurantId;
    const month = currentMonthKey();
    const [usage, entitlements] = await Promise.all([
      getCurrentUsage(restaurantId, month),
      getEffectiveEntitlements(restaurantId),
    ]);
    const quotas = buildUsageQuotaSnapshot(usage, entitlements.limits);

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
      quotas,
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

  /** Internal-only cost feed for margin and tariff reconciliation. */
  app.get(
    '/api/internal/usage/margin',
    { preHandler: requireInternalUsageToken },
    async (request, reply) => {
      const query = InternalUsageQuerySchema.parse(request.query);
      try {
        const month = query.month ?? currentMonthKey();
        return reply.send({
          month,
          rows: await getInternalUsageSummary({
            monthKey: month,
            restaurantId: query.restaurantId,
          }),
        });
      } catch (error) {
        if (error instanceof UsageInputError) {
          return reply.status(400).send({ error: error.code, message: error.message });
        }
        throw error;
      }
    },
  );
}
