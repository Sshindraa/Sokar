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
    // When we add a CallOutcome=RECOVERED state in a future phase this
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

  // ─── Empty slots analysis : jours sous-réservés sur 7 jours ───────────
  // Montre le gap entre "restaurant ouvert" et "réservations effectives".
  // Estimation du CA non réalisé basée sur l'historique du restaurant
  // (pas un chiffre inventé).
  app.get('/dashboard/empty-slots', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    const restaurant = await db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { openingHours: true },
    });

    const openingHours = restaurant.openingHours as Record<
      string,
      { open: string; close: string } | null
    > | null;
    if (!openingHours || typeof openingHours !== 'object') {
      return reply.send({
        days: [],
        summary: { underbookedDays: 0, totalOpenDays: 0, revenueAtRisk: 0 },
      });
    }

    // Fenêtre : 7 prochains jours à partir d'aujourd'hui
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);

    // Réservations confirmées sur les 7 prochains jours
    const upcomingReservations = await db.reservation.findMany({
      where: {
        restaurantId,
        status: 'CONFIRMED',
        reservedAt: { gte: today, lt: weekEnd },
      },
      select: { reservedAt: true, partySize: true, estimatedRevenue: true, confirmedRevenue: true },
    });

    // Historique : 30 derniers jours pour calculer le ticket moyen réel
    const historyStart = new Date(today);
    historyStart.setDate(historyStart.getDate() - 30);
    const historicalReservations = await db.reservation.findMany({
      where: {
        restaurantId,
        status: 'CONFIRMED',
        reservedAt: { gte: historyStart, lt: today },
      },
      select: { partySize: true, estimatedRevenue: true, confirmedRevenue: true },
    });

    // Ticket moyen par réservation sur l'historique
    const avgRevenuePerReservation =
      historicalReservations.length > 0
        ? historicalReservations.reduce(
            (sum, r) => sum + numberFromDecimal(r.confirmedRevenue ?? r.estimatedRevenue),
            0,
          ) / historicalReservations.length
        : 0;

    // Seuil "sous-réservé" : moins de 3 réservations sur une journée d'ouverture
    const UNDERBOOKED_THRESHOLD = 3;

    const dayLabels = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
    const days: Array<{
      date: string;
      dayName: string;
      isOpen: boolean;
      openTime: string | null;
      closeTime: string | null;
      reservationCount: number;
      covers: number;
      isUnderbooked: boolean;
      revenueAtRisk: number;
    }> = [];

    for (let i = 0; i < 7; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() + i);
      const dayKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
      const slot = openingHours[dayKey];

      if (!slot || !slot.open || !slot.close) {
        days.push({
          date: date.toISOString().split('T')[0],
          dayName: dayLabels[date.getDay()],
          isOpen: false,
          openTime: null,
          closeTime: null,
          reservationCount: 0,
          covers: 0,
          isUnderbooked: false,
          revenueAtRisk: 0,
        });
        continue;
      }

      // Réservations pour ce jour
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);

      const dayReservations = upcomingReservations.filter(
        (r) => r.reservedAt >= dayStart && r.reservedAt <= dayEnd,
      );

      const reservationCount = dayReservations.length;
      const covers = dayReservations.reduce((sum, r) => sum + r.partySize, 0);
      const isUnderbooked = reservationCount < UNDERBOOKED_THRESHOLD;

      // CA non réalisé = (seuil - réservations) × ticket moyen
      // Plafonné à 0 si au-dessus du seuil
      const revenueAtRisk = isUnderbooked
        ? Math.round((UNDERBOOKED_THRESHOLD - reservationCount) * avgRevenuePerReservation)
        : 0;

      days.push({
        date: date.toISOString().split('T')[0],
        dayName: dayLabels[date.getDay()],
        isOpen: true,
        openTime: slot.open,
        closeTime: slot.close,
        reservationCount,
        covers,
        isUnderbooked,
        revenueAtRisk,
      });
    }

    const openDays = days.filter((d) => d.isOpen);
    const underbookedDays = openDays.filter((d) => d.isUnderbooked);
    const totalRevenueAtRisk = underbookedDays.reduce((sum, d) => sum + d.revenueAtRisk, 0);

    return reply.send({
      days,
      summary: {
        underbookedDays: underbookedDays.length,
        totalOpenDays: openDays.length,
        revenueAtRisk: totalRevenueAtRisk,
        avgRevenuePerReservation: Math.round(avgRevenuePerReservation),
        threshold: UNDERBOOKED_THRESHOLD,
      },
    });
  });

  // ─── No-show tracking : taux de no-show et impact du rappel SMS ────────
  // Compare les réservations qui ont reçu un rappel SMS (confirmationStatus
  // PENDING/CONFIRMED) vs celles qui n'en ont pas reçu (NOT_REQUIRED).
  // Le gérant doit marquer les no-shows dans le dashboard pour que ça marche.
  app.get('/dashboard/no-show-stats', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    // Fenêtre : 90 derniers jours (assez large pour avoir du volume)
    const since = new Date();
    since.setDate(since.getDate() - 90);

    const reservations = await db.reservation.findMany({
      where: {
        restaurantId,
        createdAt: { gte: since },
        // On ne compte que les réservations qui ont eu le temps d'arriver
        // (reservedAt dans le passé)
        reservedAt: { lt: new Date() },
      },
      select: {
        status: true,
        confirmationStatus: true,
        partySize: true,
        estimatedRevenue: true,
        confirmedRevenue: true,
      },
    });

    if (reservations.length === 0) {
      return reply.send({
        total: 0,
        noShows: 0,
        noShowRate: 0,
        revenueLost: 0,
        withSms: { total: 0, noShows: 0, rate: 0 },
        withoutSms: { total: 0, noShows: 0, rate: 0 },
        impact: null,
      });
    }

    // Groupes : avec SMS (PENDING/CONFIRMED) vs sans SMS (NOT_REQUIRED)
    const withSms = reservations.filter(
      (r) => r.confirmationStatus === 'PENDING' || r.confirmationStatus === 'CONFIRMED',
    );
    const withoutSms = reservations.filter((r) => r.confirmationStatus === 'NOT_REQUIRED');

    const noShowsTotal = reservations.filter((r) => r.status === 'NO_SHOW');
    const noShowsWithSms = withSms.filter((r) => r.status === 'NO_SHOW');
    const noShowsWithoutSms = withoutSms.filter((r) => r.status === 'NO_SHOW');

    const rateWithSms = withSms.length > 0 ? (noShowsWithSms.length / withSms.length) * 100 : 0;
    const rateWithoutSms =
      withoutSms.length > 0 ? (noShowsWithoutSms.length / withoutSms.length) * 100 : 0;

    // CA perdu = somme des estimatedRevenue des no-shows
    const revenueLost = noShowsTotal.reduce(
      (sum, r) => sum + numberFromDecimal(r.confirmedRevenue ?? r.estimatedRevenue),
      0,
    );

    // Impact : réduction absolue du taux de no-show grâce au SMS
    // null si pas assez de données dans un des deux groupes
    const impact =
      withSms.length >= 5 && withoutSms.length >= 5
        ? Math.round((rateWithoutSms - rateWithSms) * 10) / 10
        : null;

    return reply.send({
      total: reservations.length,
      noShows: noShowsTotal.length,
      noShowRate: Math.round((noShowsTotal.length / reservations.length) * 1000) / 10,
      revenueLost: Math.round(revenueLost),
      withSms: {
        total: withSms.length,
        noShows: noShowsWithSms.length,
        rate: Math.round(rateWithSms * 10) / 10,
      },
      withoutSms: {
        total: withoutSms.length,
        noShows: noShowsWithoutSms.length,
        rate: Math.round(rateWithoutSms * 10) / 10,
      },
      impact, // points de pourcentage de réduction (peut être négatif si SMS inefficace)
    });
  });
}
