import { FastifyInstance } from 'fastify';
import { z }              from 'zod';
import { db }             from '../../shared/db/client';
import { requireOrg }     from '../../plugins/clerk';
import { computeRoi }     from './roi.service';

const AnalyticsQuerySchema = z.object({
  restaurantId: z.string(),
  period:       z.string().regex(/^\d{4}-\d{2}$/),
});

export async function analyticsRoutes(app: FastifyInstance) {

  app.get('/analytics/roi', { preHandler: requireOrg() }, async (req, reply) => {
    const query = AnalyticsQuerySchema.parse(req.query);
    const roi   = await computeRoi(query.restaurantId, query.period);
    return reply.send(roi);
  });

  app.get('/analytics/latency', { preHandler: requireOrg() }, async (req, reply) => {
    const query = AnalyticsQuerySchema.parse(req.query);
    const { period, restaurantId } = query;
    const [year, month] = period.split('-').map(Number);
    const start = new Date(year, month - 1, 1);
    const end   = new Date(year, month, 0, 23, 59, 59, 999);

    const traces = await db.latencyTrace.findMany({
      where: {
        call: {
          restaurantId,
          createdAt: { gte: start, lte: end },
        },
      },
      orderBy: { totalE2eMs: 'asc' },
    });

    const values = traces
      .map((t: { totalE2eMs: number | null }) => t.totalE2eMs)
      .filter((v: number | null): v is number => v !== null);

    if (values.length === 0) {
      return reply.send({ period, totalCalls: 0, p50: null, p95: null, traces: [] });
    }

    const sorted = [...values].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];

    return reply.send({
      period,
      totalCalls: traces.length,
      p50,
      p95,
      traces: traces.slice(-50),
    });
  });
}
