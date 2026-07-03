import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { FloorPlanService } from './floor-plan.service';

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

const DateQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
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
}
