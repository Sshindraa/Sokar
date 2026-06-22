/**
 * Routes pilot KPIs :
 *   - GET /api/internal/pilot-kpis : agrège les 5 KPIs cibles
 *
 * Phase 7 préparation : pas d'auth forte (réseau interne). À durcir
 * avec une API key + IP allowlist avant exposition publique.
 */

import type { FastifyInstance } from 'fastify';
import { PilotKpiService } from './pilot-kpis.service';
import { logger } from '../../shared/logger/pino';
import { db } from '../../shared/db/client';

export async function pilotRoutes(app: FastifyInstance): Promise<void> {
  const service = new PilotKpiService(db);

  app.get('/api/internal/pilot-kpis', async (_req, reply) => {
    try {
      const kpis = await service.getKpis();
      return reply.send(kpis);
    } catch (err) {
      logger.error({ err }, 'pilot kpis failed');
      return reply.status(500).send({ error: 'Internal error' });
    }
  });
}
