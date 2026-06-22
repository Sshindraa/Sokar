/**
 * Routes observability :
 *   - GET /metrics : exposition Prometheus (texte brut)
 *   - GET /health/observability : smoke test Sentry + metrics
 *
 * Pas d'auth sur /metrics (l'endpoint est scrape par Prometheus en interne).
 * En prod, on peut ajouter un allowlist d'IPs ou un auth basique.
 */

import type { FastifyInstance } from 'fastify';
import { renderMetrics } from './metrics';
import { sentryEnabled } from '../sentry/client';

export async function observabilityRoutes(app: FastifyInstance): Promise<void> {
  app.get('/metrics', async (_req, reply) => {
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
