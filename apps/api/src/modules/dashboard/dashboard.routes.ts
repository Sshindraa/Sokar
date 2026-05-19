import { FastifyInstance } from 'fastify';
import { z }              from 'zod';
import { db }             from '../../shared/db/client';

const StatsQuerySchema = z.object({
  restaurantId: z.string().uuid(),
});

const ActivityQuerySchema = z.object({
  restaurantId: z.string().uuid(),
  limit:        z.coerce.number().int().min(1).max(100).default(10),
});

export async function dashboardRoutes(app: FastifyInstance) {

  app.get('/dashboard/stats', async (req, reply) => {
    const query = StatsQuerySchema.parse(req.query);
    const { restaurantId } = query;

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

  app.get('/dashboard/recent-activity', async (req, reply) => {
    const query = ActivityQuerySchema.parse(req.query);
    const { restaurantId, limit } = query;

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
