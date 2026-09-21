/**
 * Serveur de métriques du process worker (R1-6).
 *
 * Depuis R1-1, les métriques de files, de SLO et d'alertes vivent dans
 * `dist/worker.js`, pas dans l'API. Sans endpoint dédié, Prometheus ne pouvait
 * plus les lire : les alertes SLO et le seuil de sessions vocales n'existaient
 * que sur le papier.
 *
 * Volontairement minimal — `node:http`, pas de Fastify : le process worker n'a
 * aucune raison de charger un routeur HTTP complet pour exposer une page de
 * texte. Écoute par défaut sur la loopback, avec la même garde que l'API.
 */

import { createServer, type Server } from 'node:http';
import { env } from '../../env';
import { logger } from '../logger/pino';
import { checkMetricsAuth } from './metrics-auth';
import { renderMetrics } from './metrics';

export interface MetricsServerHandle {
  readonly port: number;
  readonly host: string;
  close(): Promise<void>;
}

export async function startMetricsServer(options?: {
  port?: number;
  host?: string;
}): Promise<MetricsServerHandle> {
  const port = options?.port ?? env.METRICS_PORT;
  const host = options?.host ?? env.METRICS_BIND_HOST;

  const server: Server = createServer((req, res) => {
    if (req.method !== 'GET' || (req.url ?? '').split('?')[0] !== '/metrics') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"Not Found"}');
      return;
    }

    const auth = checkMetricsAuth({
      authorization: req.headers.authorization,
      remoteAddress: req.socket.remoteAddress,
    });
    if (!auth.ok) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (auth.status === 401) headers['www-authenticate'] = 'Basic realm="metrics"';
      res.writeHead(auth.status, headers);
      res.end(JSON.stringify({ error: auth.status === 401 ? 'Unauthorized' : 'Forbidden' }));
      return;
    }

    renderMetrics()
      .then((payload) => {
        res.writeHead(200, {
          'content-type': 'text/plain; version=0.0.4; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(payload);
      })
      .catch((error: unknown) => {
        logger.error({ err: error }, '[metrics] render failed');
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end('{"error":"metrics render failed"}');
      });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  logger.info({ host, port }, '[metrics] worker metrics endpoint listening');

  // `port: 0` demande un port éphémère : on renvoie celui réellement obtenu.
  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;

  return {
    port: boundPort,
    host,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
