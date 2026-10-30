import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { computeRoi } from './roi.service';

const AnalyticsQuerySchema = z.object({
  // restaurantId comes from requireOrg() / Clerk org context. Do not accept
  // tenant scope from query string for protected analytics routes.
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
});

export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/analytics/roi', { preHandler: requireOrg() }, async (req, reply) => {
    const query = AnalyticsQuerySchema.parse(req.query);
    const roi = await computeRoi(req.restaurantId!, query.period);
    return reply.send(roi);
  });

  app.get('/analytics/latency', { preHandler: requireOrg() }, async (req, reply) => {
    const query = AnalyticsQuerySchema.parse(req.query);
    const { period } = query;
    const [year, month] = period.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);

    const [statistics, traces] = await Promise.all([
      db.$queryRaw<Array<{ total: number; p50: number | null; p95: number | null }>>`
        WITH base AS MATERIALIZED (
          SELECT t.total_e2e_ms
          FROM latency_traces t JOIN calls c ON c.id = t.call_id
          WHERE c.restaurant_id = ${req.restaurantId!}
            AND c.created_at >= ${start} AND c.created_at <= ${end}
        ), ranked AS (
          SELECT total_e2e_ms, row_number() OVER (ORDER BY total_e2e_ms) AS position,
            count(*) OVER () AS n
          FROM base WHERE total_e2e_ms IS NOT NULL
        )
        SELECT (SELECT count(*)::int FROM base) AS total,
          max(total_e2e_ms) FILTER (WHERE position = n / 2 + 1) AS p50,
          max(total_e2e_ms) FILTER (WHERE position = n * 95 / 100 + 1) AS p95
        FROM ranked
      `,
      db.latencyTrace.findMany({
        where: {
          call: {
            restaurantId: req.restaurantId!,
            createdAt: { gte: start, lte: end },
          },
        },
        orderBy: { totalE2eMs: { sort: 'desc', nulls: 'first' } },
        take: 50,
      }),
    ]);
    const { total, p50, p95 } = statistics[0];

    if (p50 === null) {
      return reply.send({ period, totalCalls: 0, p50: null, p95: null, traces: [] });
    }

    return reply.send({
      period,
      totalCalls: total,
      p50,
      p95,
      traces: traces.reverse(),
    });
  });

  /**
   * KPIs voice du pilote. Les appels restent la source de vérité pour le
   * volume et la finalisation ; les tables voice_* apportent les mesures par
   * tour et les compteurs de parcours quand un stream a pu les observer.
   */
  app.get('/analytics/voice', { preHandler: requireOrg() }, async (req, reply) => {
    const query = AnalyticsQuerySchema.parse(req.query);
    const { period } = query;
    const [year, month] = period.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    const [
      totalCalls,
      unfinalizedCalls,
      reservationsConfirmed,
      reservationIntentAbandonedCalls,
      telemetryAggregate,
      abandonedTelemetryCalls,
    ] = await Promise.all([
      db.call.count({
        where: {
          restaurantId: req.restaurantId!,
          carrier: 'telnyx',
          createdAt: { gte: start, lte: end },
        },
      }),
      db.call.count({
        where: {
          restaurantId: req.restaurantId!,
          carrier: 'telnyx',
          createdAt: { gte: start, lte: end },
          outcome: null,
        },
      }),
      db.call.count({
        where: {
          restaurantId: req.restaurantId!,
          carrier: 'telnyx',
          createdAt: { gte: start, lte: end },
          outcome: 'RESERVED',
        },
      }),
      db.call.count({
        where: {
          restaurantId: req.restaurantId!,
          carrier: 'telnyx',
          createdAt: { gte: start, lte: end },
          intent: 'RESERVATION',
          OR: [{ outcome: null }, { outcome: { notIn: ['RESERVED', 'HANDOFF', 'MESSAGE'] } }],
        },
      }),
      db.voiceCallTelemetry.aggregate({
        where: {
          call: {
            restaurantId: req.restaurantId!,
            createdAt: { gte: start, lte: end },
          },
        },
        _count: { _all: true },
        _sum: {
          turnCount: true,
          llmTurnCount: true,
          deterministicTurnCount: true,
          fallbackTurnCount: true,
          availabilitySearchCount: true,
          availabilityFailureCount: true,
          loopCount: true,
        },
      }),
      db.voiceCallTelemetry.count({
        where: {
          call: {
            restaurantId: req.restaurantId!,
            createdAt: { gte: start, lte: end },
          },
          reservationIntentAbandoned: true,
        },
      }),
    ]);

    const totals = {
      turns: telemetryAggregate._sum.turnCount ?? 0,
      llmTurns: telemetryAggregate._sum.llmTurnCount ?? 0,
      deterministicTurns: telemetryAggregate._sum.deterministicTurnCount ?? 0,
      fallbackTurns: telemetryAggregate._sum.fallbackTurnCount ?? 0,
      availabilitySearches: telemetryAggregate._sum.availabilitySearchCount ?? 0,
      availabilityFailures: telemetryAggregate._sum.availabilityFailureCount ?? 0,
      loopsDetected: telemetryAggregate._sum.loopCount ?? 0,
      reservationIntentAbandoned: abandonedTelemetryCalls,
    };

    return reply.send({
      period,
      calls: {
        total: totalCalls,
        withTelemetry: telemetryAggregate._count._all,
        unfinalized: unfinalizedCalls,
        reservationsConfirmed,
        reservationIntentAbandoned: reservationIntentAbandonedCalls,
      },
      voice: totals,
    });
  });
}
