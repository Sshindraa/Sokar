/**
 * Routes observability :
 *   - GET /metrics : exposition Prometheus (texte brut)
 *   - GET /health/observability : smoke test Sentry + metrics
 *
 * /metrics est protégé par :
 *   - auth basique si METRICS_BASIC_AUTH_USER + METRICS_BASIC_AUTH_PASSWORD sont définis,
 *   - sinon allowlist d'IPs (SEC-006).
 * /health/observability reste public.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { renderMetrics } from './metrics';
import { sentryEnabled } from '../sentry/client';
import { env } from '../../env';

function getMetricsAllowlist(): string[] {
  return (env.METRICS_ALLOWLIST_IPS ?? '127.0.0.1, ::1')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
}

async function metricsAuthGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = env.METRICS_BASIC_AUTH_USER;
  const password = env.METRICS_BASIC_AUTH_PASSWORD;

  if (user && password) {
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('basic ')) {
      return reply
        .status(401)
        .header('WWW-Authenticate', 'Basic realm="metrics"')
        .send({ error: 'Unauthorized' });
    }

    const decoded = Buffer.from(auth.slice(6), 'base64').toString();
    const [clientUser, clientPassword] = decoded.split(':');
    if (clientUser !== user || clientPassword !== password) {
      return reply
        .status(401)
        .header('WWW-Authenticate', 'Basic realm="metrics"')
        .send({ error: 'Unauthorized' });
    }

    return;
  }

  if (!getMetricsAllowlist().includes(req.ip)) {
    return reply.status(403).send({ error: 'Forbidden' });
  }
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
