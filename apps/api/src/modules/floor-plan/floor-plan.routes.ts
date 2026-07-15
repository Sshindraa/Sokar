import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { FloorPlanService } from './floor-plan.service';
import { TableAllocationService, TableAllocationError } from './table-allocation.service';

const CreateSectionSchema = z.object({
  name: z.string().min(1).max(100),
  position: z.coerce.number().int().optional(),
});

const UpdateSectionSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  position: z.coerce.number().int().optional(),
});

const CreateTableSchema = z.object({
  sectionId: z.string().optional().nullable(),
  name: z.string().min(1).max(100),
  capacity: z.coerce.number().int().min(1),
  minCapacity: z.coerce.number().int().min(1).optional(),
  positionX: z.coerce.number().int().optional().nullable(),
  positionY: z.coerce.number().int().optional().nullable(),
  shape: z.string().max(20).optional(),
});

const UpdateTableSchema = z.object({
  sectionId: z.string().optional().nullable(),
  name: z.string().min(1).max(100).optional(),
  capacity: z.coerce.number().int().min(1).optional(),
  minCapacity: z.coerce.number().int().min(1).optional(),
  positionX: z.coerce.number().int().optional().nullable(),
  positionY: z.coerce.number().int().optional().nullable(),
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

export async function floorPlanRoutes(app: FastifyInstance): Promise<void> {
  const service = new FloorPlanService(db);

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
}
