import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';

const PeriodSchema = z.enum(['today', '7d', '30d']).default('7d');

const ActivityQuerySchema = z.object({
  // restaurantId is injected by requireOrg() from the Clerk orgId — never trust
  // a client-supplied value. The handler scopes on req.restaurantId.
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

const AnalyticsQuerySchema = z.object({
  period: PeriodSchema,
});

interface AnalyticsBucket {
  label: string;
  calls: number;
  reservations: number;
  covers: number;
  revenue: number;
}

function periodStart(period: z.infer<typeof PeriodSchema>): Date {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (period === 'today') return start;

  start.setDate(now.getDate() - (period === '7d' ? 6 : 29));
  return start;
}

function formatBucketLabel(date: Date, period: z.infer<typeof PeriodSchema>): string {
  if (period === 'today') {
    return `${String(date.getHours()).padStart(2, '0')}h`;
  }

  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: period === '30d' ? '2-digit' : undefined,
    weekday: period === '7d' ? 'short' : undefined,
  });
}

function bucketKey(date: Date, period: z.infer<typeof PeriodSchema>): string {
  if (period === 'today') {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`;
  }

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function buildBuckets(period: z.infer<typeof PeriodSchema>, start: Date): AnalyticsBucket[] {
  const bucketCount = period === 'today' ? 24 : period === '7d' ? 7 : 30;

  return Array.from({ length: bucketCount }, (_, index) => {
    const date = new Date(start);
    if (period === 'today') {
      date.setHours(index, 0, 0, 0);
    } else {
      date.setDate(start.getDate() + index);
    }

    return {
      label: formatBucketLabel(date, period),
      calls: 0,
      reservations: 0,
      covers: 0,
      revenue: 0,
    };
  });
}

function numberFromDecimal(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard/stats', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;
    const query = AnalyticsQuerySchema.parse(req.query);
    const start = periodStart(query.period);
    const where = { restaurantId, createdAt: { gte: start } };

    const [totalCalls, reservations, answeredCalls, recoverableCalls] = await Promise.all([
      db.call.count({ where }),
      db.reservation.findMany({
        where,
        select: {
          partySize: true,
          estimatedRevenue: true,
          confirmedRevenue: true,
          status: true,
          createdAt: true,
        },
      }),
      db.call.count({ where: { ...where, outcome: { not: null } } }),
      db.call.count({
        where: {
          ...where,
          outcome: { in: ['NO_ACTION', 'HANDOFF', 'ERROR'] },
        },
      }),
    ]);

    const confirmedReservations = reservations.filter(
      (reservation) => reservation.status === 'CONFIRMED',
    );
    const totalReservations = confirmedReservations.length;
    const covers = confirmedReservations.reduce(
      (sum, reservation) => sum + reservation.partySize,
      0,
    );
    const estimatedRevenue = confirmedReservations.reduce(
      (sum, reservation) =>
        sum + numberFromDecimal(reservation.confirmedRevenue ?? reservation.estimatedRevenue),
      0,
    );
    const conversionRate = totalCalls > 0 ? Math.round((totalReservations / totalCalls) * 100) : 0;
    const answeredRate = totalCalls > 0 ? Math.round((answeredCalls / totalCalls) * 100) : 0;

    // ─── Revenue Engine: revenue_recovered ──────────────────────────────
    // Approximation: the average revenue of a confirmed reservation in the
    // period × the number of recoverable calls (non-RESERVED, non-INFO).
    // This is the gross opportunity value sitting in the recovery queue —
    // i.e. the revenue at risk if the recovery SMS / follow-up never lands.
    // When we add a CallOutcome=RECOVERED state in a future sprint this
    // becomes the actual realized value, but for now it's a stable proxy
    // that gives the merchant a meaningful single number.
    const avgReservationValue = totalReservations > 0 ? estimatedRevenue / totalReservations : 0;
    const revenueRecovered = Math.round(avgReservationValue * recoverableCalls);

    return reply.send({
      period: query.period,
      total_calls: totalCalls,
      total_reservations: totalReservations,
      covers,
      conversion_rate: conversionRate,
      answered_rate: answeredRate,
      estimated_revenue: Math.round(estimatedRevenue),
      revenue_recovered: revenueRecovered,
    });
  });

  app.get('/dashboard/analytics', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;
    const query = AnalyticsQuerySchema.parse(req.query);
    const start = periodStart(query.period);
    const buckets = buildBuckets(query.period, start);
    const bucketIndexByKey = new Map<string, number>();

    buckets.forEach((_, index) => {
      const date = new Date(start);
      if (query.period === 'today') {
        date.setHours(index, 0, 0, 0);
      } else {
        date.setDate(start.getDate() + index);
      }
      bucketIndexByKey.set(bucketKey(date, query.period), index);
    });

    const [calls, reservations] = await Promise.all([
      db.call.findMany({
        where: { restaurantId, createdAt: { gte: start } },
        select: { createdAt: true },
      }),
      db.reservation.findMany({
        where: { restaurantId, createdAt: { gte: start }, status: 'CONFIRMED' },
        select: {
          createdAt: true,
          partySize: true,
          estimatedRevenue: true,
          confirmedRevenue: true,
        },
      }),
    ]);

    for (const call of calls) {
      const bucketIndex = bucketIndexByKey.get(bucketKey(call.createdAt, query.period));
      if (bucketIndex !== undefined) buckets[bucketIndex].calls++;
    }

    for (const reservation of reservations) {
      const bucketIndex = bucketIndexByKey.get(bucketKey(reservation.createdAt, query.period));
      if (bucketIndex === undefined) continue;

      buckets[bucketIndex].reservations++;
      buckets[bucketIndex].covers += reservation.partySize;
      buckets[bucketIndex].revenue += numberFromDecimal(
        reservation.confirmedRevenue ?? reservation.estimatedRevenue,
      );
    }

    return reply.send({
      period: query.period,
      data: buckets.map((bucket) => ({
        ...bucket,
        revenue: Math.round(bucket.revenue),
      })),
    });
  });

  app.get('/dashboard/weekly-calls', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;
    const start = periodStart('7d');
    const calls = await db.call.findMany({
      where: {
        restaurantId,
        createdAt: { gte: start },
      },
      select: { createdAt: true },
    });

    const counts = [0, 0, 0, 0, 0, 0, 0];
    const idxMap: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    for (const c of calls) {
      counts[idxMap[c.createdAt.getDay()]]++;
    }

    const max = Math.max(...counts, 1);
    const labels = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const data = counts.map((callsCount, i) => ({
      day: labels[i],
      calls: callsCount,
      height: Math.round((callsCount / max) * 88),
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
