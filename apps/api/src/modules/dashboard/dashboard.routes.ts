import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z }              from 'zod';
import { db }             from '../../shared/db/client';
import { getAuth }        from '@clerk/fastify';
import { computeRoi }     from '../analytics/roi.service';

const StatsQuerySchema = z.object({
  restaurantId: z.string(),
});

const ActivityQuerySchema = z.object({
  restaurantId: z.string(),
  limit:        z.coerce.number().int().min(1).max(100).default(10),
});

async function dashboardGuard(req: FastifyRequest, reply: FastifyReply) {
  const { orgId, userId } = getAuth(req);
  if (!orgId) {
    return reply.status(401).send({ error: 'Organization required' });
  }
  req.restaurantId = orgId;
  req.userId = userId;
}

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function dashboardRoutes(app: FastifyInstance) {

  app.get('/dashboard/stats', { preHandler: dashboardGuard }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    const [totalCalls, totalReservations, roi] = await Promise.all([
      db.call.count({ where: { restaurantId } }),
      db.reservation.count({ where: { restaurantId } }),
      computeRoi(restaurantId, currentPeriod()),
    ]);

    const answeredCalls = await db.call.count({
      where: { restaurantId, outcome: { not: null } },
    });

    const answeredRate = totalCalls > 0
      ? Math.round((answeredCalls / totalCalls) * 100)
      : 0;

    return reply.send({
      total_calls:        totalCalls,
      total_reservations: totalReservations,
      answered_rate:      answeredRate,
      revenue_recovered:  roi.estimatedRevenue,
      thefork_savings:    roi.theforkSavings,
      roi_multiplier:     roi.roiMultiplier,
      period:             roi.period,
    });
  });

  app.get('/dashboard/recent-activity', { preHandler: dashboardGuard }, async (req, reply) => {
    const restaurantId = req.restaurantId;
    const query = ActivityQuerySchema.parse(req.query);
    const { limit } = query;

    const [recentReservations, recentCalls] = await Promise.all([
      db.reservation.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      db.call.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
    ]);

    return reply.send({
      reservations: recentReservations,
      calls:        recentCalls,
    });
  });
}
