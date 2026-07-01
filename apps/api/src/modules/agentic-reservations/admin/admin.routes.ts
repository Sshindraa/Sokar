/**
 * Routes admin agentic-reservations.
 *
 * GET  /api/agentic/opt-in                        : opt-in status
 * POST /api/agentic/opt-in                        : toggle MCP + OpenAI Reserve
 * GET  /api/agentic/exposure-settings             : settings actuels
 * PUT  /api/agentic/exposure-settings             : update settings
 * GET  /api/agentic/mcp-clients                   : liste clés MCP actives
 * POST /api/agentic/mcp-clients                   : crée une clé MCP
 * DELETE /api/agentic/mcp-clients/:id             : révoque une clé MCP
 *
 * Auth : requireOrg() (Clerk). L'actor pour audit = `${userId}:${restaurantId}`.
 */

import { FastifyInstance } from 'fastify';
import { requireOrg } from '../../../plugins/clerk';
import { logger } from '../../../shared/logger/pino';
import { AuditLogService } from '../core/audit-log.service';
import { AgenticAdminService, OptInGuardError } from './admin.service';
import { AgentClientCreateSchema, ExposureSettingsSchema, OptInSchema } from './schemas';

export async function agenticAdminRoutes(app: FastifyInstance) {
  const audit = new AuditLogService(app.db);
  const admin = new AgenticAdminService(app.db, audit);

  // ─── Opt-in ──────────────────────────────────────────────────────

  app.get('/api/agentic/opt-in', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId;
    const status = await admin.getOptIn(restaurantId);
    return reply.send(status);
  });

  app.post('/api/agentic/opt-in', { preHandler: requireOrg() }, async (req, reply) => {
    const body = OptInSchema.parse(req.body);
    const actor = `user:${req.userId}:${req.restaurantId}`;
    try {
      await admin.setOptIn({
        restaurantId: req.restaurantId,
        input: body,
        actor,
      });
      const status = await admin.getOptIn(req.restaurantId);
      return reply.send(status);
    } catch (err) {
      if (err instanceof OptInGuardError) {
        return reply.status(409).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });

  // ─── Exposure settings ──────────────────────────────────────────

  app.get('/api/agentic/exposure-settings', { preHandler: requireOrg() }, async (req, reply) => {
    const settings = await admin.getExposureSettings(req.restaurantId);
    return reply.send(settings);
  });

  app.put('/api/agentic/exposure-settings', { preHandler: requireOrg() }, async (req, reply) => {
    const body = ExposureSettingsSchema.parse(req.body);
    const actor = `user:${req.userId}:${req.restaurantId}`;
    try {
      await admin.setExposureSettings({
        restaurantId: req.restaurantId,
        input: body,
        actor,
      });
      const settings = await admin.getExposureSettings(req.restaurantId);
      return reply.send(settings);
    } catch (err) {
      if (err instanceof Error && err.name === 'PolicyValidationError') {
        const code = (err as { code?: string }).code;
        return reply.status(409).send({ error: err.message, code });
      }
      logger.error({ err, restaurantId: req.restaurantId }, 'exposure settings update failed');
      throw err;
    }
  });

  // ─── MCP clients ────────────────────────────────────────────────

  app.get('/api/agentic/mcp-clients', { preHandler: requireOrg() }, async (req, reply) => {
    const clients = await admin.listAgentClients(req.restaurantId);
    return reply.send({ clients });
  });

  app.post('/api/agentic/mcp-clients', { preHandler: requireOrg() }, async (req, reply) => {
    const body = AgentClientCreateSchema.parse(req.body);
    const actor = `user:${req.userId}:${req.restaurantId}`;
    const result = await admin.createAgentClient({
      restaurantId: req.restaurantId,
      input: body,
      actor,
    });
    return reply.status(201).send(result);
  });

  app.delete('/api/agentic/mcp-clients/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const params = req.params as { id: string };
    const actor = `user:${req.userId}:${req.restaurantId}`;
    try {
      await admin.revokeAgentClient({
        restaurantId: req.restaurantId,
        clientId: params.id,
        actor,
      });
      return reply.status(204).send();
    } catch (err) {
      if (err instanceof OptInGuardError) {
        return reply.status(404).send({ error: err.message, code: err.code });
      }
      throw err;
    }
  });
}
