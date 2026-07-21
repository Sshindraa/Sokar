import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { FloorPlanService, FloorPlanValidationError } from './floor-plan.service';
import { TableAllocationService, TableAllocationError } from './table-allocation.service';
import { CapacityAwareAvailabilityService } from './availability-capacity-aware.service';
import { ServiceCopilotService } from './service-copilot.service';
import { ServiceCopilotSimulationService } from './service-copilot-simulation.service';
import { ServiceCopilotDelayImpactService } from './service-copilot-delay-impact.service';
import { ServiceCopilotCommunicationService } from './service-copilot-communication.service';
import {
  DelayRecoveryConflictError,
  ServiceCopilotDelayRecoveryService,
} from './service-copilot-delay-recovery.service';
import { ServiceCopilotDelayRecoveryHistoryService } from './service-copilot-delay-recovery-history.service';
import { ServiceCopilotPulseService } from './service-copilot-pulse.service';
import { ServiceCopilotTelemetryService } from './service-copilot-telemetry.service';
import { SERVICE_COPILOT_RULE_VERSION } from './service-copilot.service';
import { HoldService } from '../agentic-reservations/core/hold.service';
import { ReservationService } from '../agentic-reservations/core/reservation.service';
import { WaitingListService } from '../agentic-reservations/core/waiting-list.service';
import {
  WaitingListEntryNotFoundError,
  WaitingListAlreadyPromotedError,
} from '../agentic-reservations/core/waiting-list.errors';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { IdempotencyService } from '../agentic-reservations/core/idempotency.service';
import { PrismaIdempotencyStore } from '../agentic-reservations/core/prisma-store';
import { WaitingListAdminQuerySchema } from './waiting-list.types';

const CreateSectionSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.coerce.number().int().optional(),
  floorPlanId: z.string().optional(),
});

const UpdateSectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.coerce.number().int().optional(),
  floorPlanId: z.string().optional(),
});

const OptionalDimension = z.preprocess(
  (val) => (val === null || val === undefined ? val : Number(val)),
  z.union([z.number().int().min(1), z.null()]).optional(),
);

const OptionalInt = z.preprocess(
  (val) => (val === undefined ? val : Number(val)),
  z.number().int().optional(),
);

const CreateTableSchema = z.object({
  sectionId: z.string().optional().nullable(),
  name: z.string().min(1).max(100),
  capacity: z.coerce.number().int().min(1),
  minCapacity: z.coerce.number().int().min(1).optional(),
  positionX: z.coerce.number().int().optional().nullable(),
  positionY: z.coerce.number().int().optional().nullable(),
  width: OptionalDimension,
  height: OptionalDimension,
  rotation: OptionalInt,
  shape: z.string().max(20).optional(),
  assignedServer: z.string().max(100).optional().nullable(),
  floorPlanId: z.string().optional(),
});

const UpdateTableSchema = z.object({
  sectionId: z.string().optional().nullable(),
  name: z.string().min(1).max(100).optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  minCapacity: z.coerce.number().int().min(1).optional(),
  positionX: z.coerce.number().int().optional().nullable(),
  positionY: z.coerce.number().int().optional().nullable(),
  width: OptionalDimension,
  height: OptionalDimension,
  rotation: OptionalInt,
  shape: z.string().max(20).optional(),
  assignedServer: z.string().max(100).optional().nullable(),
  isActive: z.boolean().optional(),
  floorPlanId: z.string().optional(),
});

const CreateFloorPlanSchema = z.object({
  name: z.string().min(1).max(100),
  isDefault: z.boolean().optional(),
});

const LegacyCreateFloorPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const UpdateFloorPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  width: z.coerce.number().int().optional(),
  height: z.coerce.number().int().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const CreateWallSchema = z.object({
  x1: z.coerce.number().int(),
  y1: z.coerce.number().int(),
  x2: z.coerce.number().int(),
  y2: z.coerce.number().int(),
  type: z.string().max(20).optional(),
  name: z.string().max(100).optional().nullable(),
  floorPlanId: z.string().optional(),
});

const UpdateWallSchema = z.object({
  x1: z.coerce.number().int().optional(),
  y1: z.coerce.number().int().optional(),
  x2: z.coerce.number().int().optional(),
  y2: z.coerce.number().int().optional(),
  type: z.string().max(20).optional(),
  name: z.string().max(100).optional().nullable(),
  floorPlanId: z.string().optional(),
});

const DateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  floorPlanId: z.string().optional(),
});

const ReallocateReservationSchema = z.object({
  tableId: z.string().min(1),
});

const UpdateReservationStateSchema = z.object({
  state: z.enum(['SEATED', 'HONORED']),
});

const CreateWalkInSchema = z.object({
  tableId: z.string().min(1),
  partySize: z.number().int().min(1).max(20),
  customerName: z.string().max(120).optional(),
  idempotencyKey: z.string().min(1).max(128),
});

const AssignTableSchema = z.object({
  tableId: z.string().min(1),
});

const SimulateSchema = z.object({
  partySize: z.number().int().min(1).max(99),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  preferredSectionId: z.string().optional(),
});

const SimulateDelayImpactSchema = z.object({
  reservationId: z.string().min(1),
  delayMinutes: z.number().int().min(5).max(180),
});

const ApplyDelayImpactSchema = SimulateDelayImpactSchema.extend({
  alternativeTableId: z.string().min(1),
  waitingListEntryId: z.string().min(1),
  waitingListAcceptanceConfirmed: z.boolean().optional().default(false),
  delayReportId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

const RevertDelayImpactSchema = z.object({
  reservationId: z.string().min(1),
  operationId: z.string().min(1).max(256),
});

const DelayRecoveryHistoryQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10),
});

const CopilotTelemetryEventSchema = z.object({
  token: z.string().min(20).max(4_096),
  event: z.enum(['VIEWED', 'OPENED']),
  idempotencyKey: z.string().min(1).max(256),
  clientTime: z.string().datetime().optional(),
});

function getFloorPlanIdFromQuery(query: unknown): string | undefined {
  const parsed = z.object({ floorPlanId: z.string().optional() }).safeParse(query ?? {});
  return parsed.success ? parsed.data.floorPlanId : undefined;
}

export async function floorPlanRoutes(app: FastifyInstance): Promise<void> {
  const service = new FloorPlanService(db);
  const audit = new AuditLogService(db);
  const holds = new HoldService(db, audit);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const reservations = new ReservationService(db, audit, holds, idempotency);
  const allocation = new TableAllocationService(db);
  const waitingList = new WaitingListService(db, allocation, audit);
  const copilot = new ServiceCopilotService(db);
  const simulation = new ServiceCopilotSimulationService(db);
  const delayImpact = new ServiceCopilotDelayImpactService(db);
  const delayRecovery = new ServiceCopilotDelayRecoveryService(db);
  const delayRecoveryHistory = new ServiceCopilotDelayRecoveryHistoryService(db);
  const copilotPulse = new ServiceCopilotPulseService(db);
  const telemetry = new ServiceCopilotTelemetryService(db);
  const communication = new ServiceCopilotCommunicationService(db);

  // ─── Legacy single floor-plan endpoints (default active floor plan) ───

  app.get('/restaurants/:id/floor-plan', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const floorPlan = await service.getOrCreateFloorPlan(restaurantId);
    return reply.send(floorPlan);
  });

  app.post('/restaurants/:id/floor-plan', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const body = LegacyCreateFloorPlanSchema.parse(req.body);
    const floorPlan = await service.getOrCreateFloorPlan(restaurantId);
    if (body.name) {
      const updated = await service.updateFloorPlanById(floorPlan.id, { name: body.name });
      return reply.status(200).send(updated);
    }
    return reply.status(201).send(floorPlan);
  });

  app.patch('/restaurants/:id/floor-plan', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const body = UpdateFloorPlanSchema.parse(req.body);
    const floorPlan = await service.updateFloorPlan(restaurantId, body);
    return reply.send(floorPlan);
  });

  // ─── Multi floor-plan endpoints ───

  app.get('/restaurants/:id/floor-plans', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const floorPlans = await service.listFloorPlans(restaurantId);
    return reply.send(floorPlans);
  });

  app.post('/restaurants/:id/floor-plans', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const body = CreateFloorPlanSchema.parse(req.body);
    const floorPlan = await service.createFloorPlan(restaurantId, body);
    return reply.status(201).send(floorPlan);
  });

  app.get(
    '/restaurants/:id/floor-plans/:floorPlanId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, floorPlanId } = req.params as { id: string; floorPlanId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const floorPlan = await service.getFloorPlanById(floorPlanId);
      if (floorPlan.restaurantId !== id) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      return reply.send(floorPlan);
    },
  );

  app.patch(
    '/restaurants/:id/floor-plans/:floorPlanId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, floorPlanId } = req.params as { id: string; floorPlanId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = UpdateFloorPlanSchema.parse(req.body);
      const floorPlan = await service.updateFloorPlanById(floorPlanId, body);
      if (floorPlan.restaurantId !== id) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      return reply.send(floorPlan);
    },
  );

  app.delete(
    '/restaurants/:id/floor-plans/:floorPlanId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, floorPlanId } = req.params as { id: string; floorPlanId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      await service.deleteFloorPlan(floorPlanId);
      return reply.status(204).send();
    },
  );

  // ─── Service Copilot ───

  app.get(
    '/restaurants/:id/service-copilot/recommendations',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const recs = await copilot.getRecommendations(restaurantId);
      const recommendations = recs.map((recommendation) => {
        const telemetryToken = telemetry.issueToken({ restaurantId, recommendation });
        return telemetryToken ? { ...recommendation, telemetryToken } : recommendation;
      });
      return reply.send({ recommendations });
    },
  );

  app.post(
    '/restaurants/:id/service-copilot/telemetry',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const body = CopilotTelemetryEventSchema.parse(req.body);
      try {
        await telemetry.recordClientEvent({
          token: body.token,
          event: body.event,
          idempotencyKey: body.idempotencyKey,
          actor: req.userId,
          clientTime: body.clientTime ? new Date(body.clientTime) : undefined,
        });
        return reply.status(204).send();
      } catch {
        return reply.status(400).send({ error: 'Événement Copilot invalide ou expiré.' });
      }
    },
  );

  app.get(
    '/restaurants/:id/service-copilot/pulse',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const query = DateQuerySchema.pick({ date: true }).parse(req.query);
      const pulse = await copilotPulse.getPulse({ restaurantId, date: query.date });
      return reply.send(pulse);
    },
  );

  app.post(
    '/restaurants/:id/service-copilot/simulate',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const body = SimulateSchema.parse(req.body);
      const result = await simulation.simulate({
        restaurantId,
        partySize: body.partySize,
        startsAt: new Date(body.startsAt),
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        preferredSectionId: body.preferredSectionId,
      });
      return reply.send(result);
    },
  );

  app.post(
    '/restaurants/:id/service-copilot/delay-impact',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const body = SimulateDelayImpactSchema.parse(req.body);
      const result = await delayImpact.simulate({
        restaurantId,
        reservationId: body.reservationId,
        delayMinutes: body.delayMinutes,
      });
      return reply.send(result);
    },
  );

  app.post(
    '/restaurants/:id/service-copilot/delay-impact/drafts',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const body = SimulateDelayImpactSchema.parse(req.body);
      const impact = await delayImpact.simulate({
        restaurantId,
        reservationId: body.reservationId,
        delayMinutes: body.delayMinutes,
      });
      return reply.send({ impact, drafts: await communication.buildDrafts(restaurantId, impact) });
    },
  );

  app.post(
    '/restaurants/:id/service-copilot/delay-impact/apply',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const body = ApplyDelayImpactSchema.parse(req.body);
      try {
        const result = await delayRecovery.apply({
          restaurantId,
          reservationId: body.reservationId,
          delayMinutes: body.delayMinutes,
          alternativeTableId: body.alternativeTableId,
          waitingListEntryId: body.waitingListEntryId,
          waitingListAcceptanceConfirmed: body.waitingListAcceptanceConfirmed,
          delayReportId: body.delayReportId,
          idempotencyKey: body.idempotencyKey,
          actor: req.restaurantId ?? 'dashboard',
        });
        if (body.delayReportId) {
          try {
            await telemetry.recordServerEvent({
              restaurantId,
              occurrenceKey: `reported-delay:${body.delayReportId}`,
              kind: 'reported-delay',
              entityId: body.reservationId,
              ruleVersion: SERVICE_COPILOT_RULE_VERSION,
              event: 'APPLIED',
              idempotencyKey: `copilot-delay-applied:${result.operationId}`,
              actor: req.userId,
              metadata: { operationId: result.operationId },
            });
          } catch (telemetryError) {
            req.log.warn({ err: telemetryError }, 'service copilot telemetry apply failed');
          }
        }
        return reply.send(result);
      } catch (err) {
        if (err instanceof DelayRecoveryConflictError) {
          if (body.delayReportId) {
            try {
              await telemetry.recordServerEvent({
                restaurantId,
                occurrenceKey: `reported-delay:${body.delayReportId}`,
                kind: 'reported-delay',
                entityId: body.reservationId,
                ruleVersion: SERVICE_COPILOT_RULE_VERSION,
                event: 'CONFLICTED',
                idempotencyKey: `copilot-delay-conflict:${body.idempotencyKey ?? body.delayReportId}`,
                reasonCode: 'apply_conflict',
                actor: req.userId,
              });
            } catch (telemetryError) {
              req.log.warn({ err: telemetryError }, 'service copilot telemetry conflict failed');
            }
          }
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    '/restaurants/:id/service-copilot/delay-impact/revert',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const body = RevertDelayImpactSchema.parse(req.body);
      try {
        const result = await delayRecovery.revert({
          restaurantId,
          reservationId: body.reservationId,
          operationId: body.operationId,
          actor: req.restaurantId ?? 'dashboard',
        });
        if (result.delayReportId) {
          try {
            await telemetry.recordServerEvent({
              restaurantId,
              occurrenceKey: `reported-delay:${result.delayReportId}`,
              kind: 'reported-delay',
              entityId: body.reservationId,
              ruleVersion: SERVICE_COPILOT_RULE_VERSION,
              event: 'REVERTED',
              idempotencyKey: `copilot-delay-reverted:${body.operationId}`,
              actor: req.userId,
              metadata: { operationId: body.operationId },
            });
          } catch (telemetryError) {
            req.log.warn({ err: telemetryError }, 'service copilot telemetry revert failed');
          }
        }
        return reply.send(result);
      } catch (err) {
        if (err instanceof DelayRecoveryConflictError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    '/restaurants/:id/service-copilot/delay-recoveries',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }
      const query = DelayRecoveryHistoryQuerySchema.parse(req.query);
      const recoveries = await delayRecoveryHistory.list({
        restaurantId,
        date: query.date,
        limit: query.limit,
      });
      return reply.send({ recoveries });
    },
  );

  // ─── Sections ───

  app.post(
    '/restaurants/:id/floor-plan/sections',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateSectionSchema.parse(req.body);
      const section = await service.createSection(restaurantId, body, body.floorPlanId);
      return reply.status(201).send(section);
    },
  );

  app.put(
    '/restaurants/:id/floor-plan/sections/:sectionId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, sectionId } = req.params as { id: string; sectionId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = UpdateSectionSchema.parse(req.body);
      const section = await service.updateSection(id, sectionId, body, body.floorPlanId);
      return reply.send(section);
    },
  );

  app.delete(
    '/restaurants/:id/floor-plan/sections/:sectionId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, sectionId } = req.params as { id: string; sectionId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const floorPlanId = getFloorPlanIdFromQuery(req.query);
      await service.deleteSection(id, sectionId, floorPlanId);
      return reply.status(204).send();
    },
  );

  // ─── Tables ───

  app.post(
    '/restaurants/:id/floor-plan/tables',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateTableSchema.parse(req.body);
      const table = await service.createTable(restaurantId, body, body.floorPlanId);
      return reply.status(201).send(table);
    },
  );

  app.patch(
    '/restaurants/:id/floor-plan/tables/:tableId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, tableId } = req.params as { id: string; tableId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = UpdateTableSchema.parse(req.body);
      const table = await service.updateTable(id, tableId, body, body.floorPlanId);
      return reply.send(table);
    },
  );

  app.delete(
    '/restaurants/:id/floor-plan/tables/:tableId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, tableId } = req.params as { id: string; tableId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const floorPlanId = getFloorPlanIdFromQuery(req.query);
      await service.deleteTable(id, tableId, floorPlanId);
      return reply.status(204).send();
    },
  );

  // ─── Walls ───

  app.post(
    '/restaurants/:id/floor-plan/walls',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateWallSchema.parse(req.body);
      const wall = await service.createWall(restaurantId, body, body.floorPlanId);
      return reply.status(201).send(wall);
    },
  );

  app.patch(
    '/restaurants/:id/floor-plan/walls/:wallId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, wallId } = req.params as { id: string; wallId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = UpdateWallSchema.parse(req.body);
      const wall = await service.updateWall(id, wallId, body, body.floorPlanId);
      return reply.send(wall);
    },
  );

  app.delete(
    '/restaurants/:id/floor-plan/walls/:wallId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, wallId } = req.params as { id: string; wallId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const floorPlanId = getFloorPlanIdFromQuery(req.query);
      await service.deleteWall(id, wallId, floorPlanId);
      return reply.status(204).send();
    },
  );

  // ─── Planning ───

  app.get(
    '/restaurants/:id/floor-plan/reservations',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const query = DateQuerySchema.parse(req.query);
      const reservations = await service.getPlanning(restaurantId, query.date, query.floorPlanId);
      return reply.send(reservations);
    },
  );

  app.patch(
    '/restaurants/:id/floor-plan/reservations/:reservationId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, reservationId } = req.params as { id: string; reservationId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = ReallocateReservationSchema.parse(req.body);

      try {
        const reservation = await new TableAllocationService(db).reallocate(
          reservationId,
          body.tableId,
        );
        return reply.send(reservation);
      } catch (err) {
        if (err instanceof TableAllocationError) {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.patch(
    '/restaurants/:id/floor-plan/reservations/:reservationId/state',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, reservationId } = req.params as { id: string; reservationId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const { state } = UpdateReservationStateSchema.parse(req.body);

      try {
        await reservations.transitionState({
          reservationId,
          restaurantId: id,
          toState: state,
          actor: req.restaurantId ?? 'dashboard',
        });
      } catch (err) {
        if (err instanceof TableAllocationError) {
          if (err.code === 'TABLE_NOT_FOUND') {
            return reply.status(404).send({ error: err.message });
          }
          if (err.code === 'TABLE_NOT_AVAILABLE') {
            return reply.status(409).send({ error: err.message });
          }
          return reply.status(400).send({ error: err.message });
        }
        if (
          err instanceof Error &&
          (err.name === 'InvalidStateTransitionError' || err.name === 'InvalidStateInvariantError')
        ) {
          return reply.status(409).send({ error: err.message });
        }
        if (err instanceof Error && err.message.includes('transition')) {
          return reply.status(409).send({ error: err.message });
        }
        if (err instanceof Error && err.name === 'ReservationNotFoundError') {
          return reply.status(404).send({ error: 'Réservation introuvable' });
        }
        throw err;
      }

      return reply.status(204).send();
    },
  );

  app.post(
    '/restaurants/:id/floor-plan/walk-ins',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateWalkInSchema.parse(req.body);

      try {
        const result = await service.createWalkIn({
          restaurantId: id,
          tableId: body.tableId,
          partySize: body.partySize,
          customerName: body.customerName,
          idempotencyKey: body.idempotencyKey,
        });
        return reply.status(201).send({ id: result.id });
      } catch (err) {
        if (err instanceof TableAllocationError) {
          if (err.code === 'TABLE_NOT_FOUND') {
            return reply.status(404).send({ error: err.message });
          }
          if (err.code === 'TABLE_NOT_AVAILABLE') {
            return reply.status(409).send({ error: err.message });
          }
          return reply.status(400).send({ error: err.message });
        }
        if (err instanceof FloorPlanValidationError) {
          return reply.status(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  // Phase 5 — Recommandation read-only d'une table (best-fit), sans mutation.
  app.get(
    '/restaurants/:id/floor-plan/reservations/:reservationId/suggest-table',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, reservationId } = req.params as { id: string; reservationId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const reservation = await db.reservation.findUnique({
        where: { id: reservationId },
        select: {
          restaurantId: true,
          partySize: true,
          startsAt: true,
          endsAt: true,
          tableId: true,
        },
      });
      if (!reservation || reservation.restaurantId !== id) {
        return reply.status(404).send({ error: 'Réservation introuvable' });
      }
      if (!reservation.startsAt || !reservation.endsAt) {
        return reply.status(409).send({ error: 'Créneau de réservation manquant' });
      }

      const suggestions = await allocation.suggest(
        {
          restaurantId: id,
          partySize: reservation.partySize,
          startsAt: reservation.startsAt,
          endsAt: reservation.endsAt,
          excludeTableIds: reservation.tableId ? [reservation.tableId] : undefined,
        },
        3,
      );

      if (suggestions.length === 0) {
        return reply.send({
          tableId: null,
          reason: 'Aucune table disponible',
          suggestions: [],
        });
      }

      const best = suggestions[0];
      return reply.send({
        // Compatibilité ascendante : l'UI historique lit `tableId`/`reason`.
        tableId: best.table.id,
        reason: best.reasons.join(' · '),
        suggestions: suggestions.map((s) => ({
          tableId: s.table.id,
          name: s.table.name,
          capacity: s.table.capacity,
          sectionId: s.table.sectionId,
          score: s.score,
          reasons: s.reasons,
        })),
      });
    },
  );

  // Phase 5 — Commit transactionnel de l'assignation (verrou + revalidation dispo).
  app.patch(
    '/restaurants/:id/floor-plan/reservations/:reservationId/assign-table',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id, reservationId } = req.params as { id: string; reservationId: string };
      if (id !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const { tableId } = AssignTableSchema.parse(req.body);

      try {
        await allocation.reallocate(reservationId, tableId);
      } catch (err) {
        if (err instanceof TableAllocationError) {
          const status = err.code === 'TABLE_NOT_AVAILABLE' ? 409 : 400;
          return reply.status(status).send({ error: err.message });
        }
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
          return reply.status(404).send({ error: 'Table ou réservation introuvable' });
        }
        throw err;
      }

      return reply.status(204).send();
    },
  );

  // ─── Waiting list ───

  app.get('/restaurants/:id/waiting-list', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const query = WaitingListAdminQuerySchema.safeParse(req.query ?? {});
    if (!query.success) {
      return reply.status(400).send({ error: 'Invalid query', details: query.error.format() });
    }

    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: { timezone: true },
    });

    const entries = await waitingList.list({
      restaurantId,
      date: query.data.date,
      status: query.data.status,
      timeZone: restaurant?.timezone ?? 'Europe/Paris',
    });

    return reply.send(entries);
  });

  app.post(
    '/restaurants/:id/waiting-list/:entryId/promote',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, entryId } = req.params as { id: string; entryId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const entry = await db.waitingListEntry.findUnique({
        where: { id: entryId },
        select: { restaurantId: true },
      });
      if (!entry || entry.restaurantId !== restaurantId) {
        return reply.status(404).send({ error: 'Entrée introuvable' });
      }

      try {
        const reservation = await waitingList.promoteEntry(entryId);
        if (!reservation) {
          return reply.status(409).send({ error: 'no_compatible_table' });
        }

        await CapacityAwareAvailabilityService.invalidateAvailability(restaurantId);
        return reply.status(200).send(reservation);
      } catch (err: unknown) {
        if (err instanceof WaitingListAlreadyPromotedError) {
          return reply.status(409).send({ error: 'already_promoted' });
        }
        if (err instanceof WaitingListEntryNotFoundError) {
          return reply.status(404).send({ error: 'Entrée introuvable' });
        }
        throw err;
      }
    },
  );

  app.delete(
    '/restaurants/:id/waiting-list/:entryId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, entryId } = req.params as { id: string; entryId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      try {
        await waitingList.cancelByStaff(entryId, restaurantId);
      } catch (err: unknown) {
        if (err instanceof WaitingListEntryNotFoundError) {
          return reply.status(404).send({ error: 'Entrée introuvable' });
        }
        throw err;
      }

      return reply.status(204).send();
    },
  );
}
