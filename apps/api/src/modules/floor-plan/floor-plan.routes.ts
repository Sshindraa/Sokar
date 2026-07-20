import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { FloorPlanService, FloorPlanValidationError } from './floor-plan.service';
import { TableAllocationService, TableAllocationError } from './table-allocation.service';
import { HoldService } from '../agentic-reservations/core/hold.service';
import { ReservationService } from '../agentic-reservations/core/reservation.service';
import { AuditLogService } from '../agentic-reservations/core/audit-log.service';
import { IdempotencyService } from '../agentic-reservations/core/idempotency.service';
import { PrismaIdempotencyStore } from '../agentic-reservations/core/prisma-store';

const CreateSectionSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.coerce.number().int().optional(),
});

const UpdateSectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.coerce.number().int().optional(),
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
  isActive: z.boolean().optional(),
});

const CreateFloorPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
});

const UpdateFloorPlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  width: z.coerce.number().int().optional(),
  height: z.coerce.number().int().optional(),
});

const CreateWallSchema = z.object({
  x1: z.coerce.number().int(),
  y1: z.coerce.number().int(),
  x2: z.coerce.number().int(),
  y2: z.coerce.number().int(),
  type: z.string().max(20).optional(),
  name: z.string().max(100).optional().nullable(),
});

const UpdateWallSchema = z.object({
  x1: z.coerce.number().int().optional(),
  y1: z.coerce.number().int().optional(),
  x2: z.coerce.number().int().optional(),
  y2: z.coerce.number().int().optional(),
  type: z.string().max(20).optional(),
  name: z.string().max(100).optional().nullable(),
});

const DateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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

export async function floorPlanRoutes(app: FastifyInstance): Promise<void> {
  const service = new FloorPlanService(db);
  const audit = new AuditLogService(db);
  const holds = new HoldService(db, audit);
  const idempotency = new IdempotencyService(new PrismaIdempotencyStore(db));
  const reservations = new ReservationService(db, audit, holds, idempotency);
  const allocation = new TableAllocationService(db);

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

    const body = CreateFloorPlanSchema.parse(req.body);
    const floorPlan = await service.createFloorPlan(restaurantId, body.name);
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

  app.post(
    '/restaurants/:id/floor-plan/sections',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateSectionSchema.parse(req.body);
      const section = await service.createSection(restaurantId, body);
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
      const section = await service.updateSection(id, sectionId, body);
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

      await service.deleteSection(id, sectionId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/restaurants/:id/floor-plan/tables',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateTableSchema.parse(req.body);
      const table = await service.createTable(restaurantId, body);
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
      const table = await service.updateTable(id, tableId, body);
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

      await service.deleteTable(id, tableId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/restaurants/:id/floor-plan/walls',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = CreateWallSchema.parse(req.body);
      const wall = await service.createWall(restaurantId, body);
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
      const wall = await service.updateWall(id, wallId, body);
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

      await service.deleteWall(id, wallId);
      return reply.status(204).send();
    },
  );

  app.get(
    '/restaurants/:id/floor-plan/reservations',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const restaurantId = (req.params as { id: string }).id;
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const query = DateQuerySchema.parse(req.query);
      const reservations = await service.getPlanning(restaurantId, query.date);
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

      const suggested = await allocation.allocate({
        restaurantId: id,
        partySize: reservation.partySize,
        startsAt: reservation.startsAt,
        endsAt: reservation.endsAt,
        excludeTableIds: reservation.tableId ? [reservation.tableId] : undefined,
      });

      if (!suggested) {
        return reply.send({ tableId: null, reason: 'Aucune table disponible' });
      }

      return reply.send({
        tableId: suggested.id,
        reason: `Meilleure table (capacité ${suggested.capacity}, section ${
          suggested.sectionId ?? '—'
        })`,
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
}
