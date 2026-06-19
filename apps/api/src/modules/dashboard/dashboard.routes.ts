import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { computeRoi } from '../analytics/roi.service';

const ActivityQuerySchema = z.object({
  // restaurantId is injected by requireOrg() from the Clerk orgId — never trust
  // a client-supplied value. The handler scopes on req.restaurantId.
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

function currentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/stats', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    const [totalCalls, totalReservations, roi] = await Promise.all([
      db.call.count({ where: { restaurantId } }),
      db.reservation.count({ where: { restaurantId } }),
      computeRoi(restaurantId, currentPeriod()),
    ]);

    const answeredCalls = await db.call.count({
      where: { restaurantId, outcome: { not: null } },
    });

    const answeredRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

    return reply.send({
      total_calls: totalCalls,
      total_reservations: totalReservations,
      answered_rate: answeredRate,
      revenue_recovered: roi.estimatedRevenue,
      thefork_savings: roi.theforkSavings,
      roi_multiplier: roi.roiMultiplier,
      period: roi.period,
    });
  });

  app.get('/dashboard/weekly-calls', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 6);
    startOfWeek.setHours(0, 0, 0, 0);

    const calls = await db.call.findMany({
      where: {
        restaurantId,
        createdAt: { gte: startOfWeek },
      },
      select: { createdAt: true },
    });

    // Lundi=0 … Dimanche=6
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const idxMap: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    for (const c of calls) {
      counts[idxMap[c.createdAt.getDay()]]++;
    }

    const max = Math.max(...counts, 1);
    const labels = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const data = counts.map((calls, i) => ({
      day: labels[i],
      calls,
      height: Math.round((calls / max) * 88),
    }));

    return reply.send({ data, total: calls.length });
  });

  app.get('/dashboard/recent-activity', { preHandler: requireOrg() }, async (req, reply) => {
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
      calls: recentCalls,
    });
  });
}
