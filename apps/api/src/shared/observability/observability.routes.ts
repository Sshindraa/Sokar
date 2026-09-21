/**
 * Routes observability :
 *   - GET /metrics : exposition Prometheus (texte brut)
 *   - GET /health/observability : smoke test Sentry + metrics
 *
 * /metrics est protégé par la garde partagée `metrics-auth.ts` (auth basique si
 * configurée, sinon allowlist d'IP — SEC-006). Le process worker expose le même
 * endpoint via un petit serveur HTTP (`metrics-server.ts`), parce que les
 * métriques de files et de SLO y vivent depuis R1-1.
 *
 * /health/observability reste public.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { renderMetrics } from './metrics';
import { sentryEnabled } from '../sentry/client';
import { checkMetricsAuth } from './metrics-auth';

async function metricsAuthGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const result = checkMetricsAuth({
    authorization: req.headers.authorization,
    remoteAddress: req.ip,
  });
  if (result.ok) return;

  if (result.status === 401) {
    return reply
      .status(401)
      .header('WWW-Authenticate', 'Basic realm="metrics"')
      .send({ error: 'Unauthorized' });
  }
  return reply.status(403).send({ error: 'Forbidden' });
}

export async function observabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', { onRequest: metricsAuthGuard }, async (_req, reply) => {
    const payload = await renderMetrics();
    return reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .header('Cache-Control', 'no-store')
      .send(payload);
  });

  app.get('/health/observability', async (_req, reply) => {
    return reply.send({
      metrics: true,
      sentry: sentryEnabled(),
      uptime: process.uptime(),
    });
  });
}
