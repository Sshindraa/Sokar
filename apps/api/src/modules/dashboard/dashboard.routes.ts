import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z }              from 'zod';
import { db }             from '../../shared/db/client';
import { getAuth }        from '@clerk/fastify';

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
  (req as any).restaurantId = orgId;
  (req as any).userId = userId;
}

export async function dashboardRoutes(app: FastifyInstance) {

  app.get('/dashboard/stats', { preHandler: dashboardGuard }, async (req, reply) => {
    const restaurantId = (req as any).restaurantId;

    const [totalCalls, totalReservations] = await Promise.all([
      db.call.count({ where: { restaurantId } }),
      db.reservation.count({ where: { restaurantId } }),
    ]);

    const answeredCalls = await db.call.count({
      where: { restaurantId, outcome: { not: null } },
    });

    const answeredRate = totalCalls > 0
      ? Math.round((answeredCalls / totalCalls) * 100)
      : 0;

    const revenueRecovered = Math.round(totalReservations * 35 * 2.5);

    return reply.send({
      total_calls:        totalCalls,
      total_reservations: totalReservations,
      answered_rate:      answeredRate,
      revenue_recovered:  revenueRecovered,
    });
  });

  app.get('/dashboard/recent-activity', { preHandler: dashboardGuard }, async (req, reply) => {
    const restaurantId = (req as any).restaurantId;
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
