import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { GiftCardPackService } from './gift-card-pack.service';

const CreatePackSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  amount: z.coerce.number().positive(),
  minPartySize: z.coerce.number().int().min(1).optional(),
  maxPartySize: z.coerce.number().int().min(1).optional(),
});

const UpdatePackSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  amount: z.coerce.number().positive().optional(),
  minPartySize: z.coerce.number().int().min(1).optional(),
  maxPartySize: z.coerce.number().int().min(1).optional(),
});

export async function giftCardPackRoutes(app: FastifyInstance): Promise<void> {
  const service = new GiftCardPackService(db);

  app.get('/restaurants/:id/gift-card-packs', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const packs = await service.list(restaurantId);
    return reply.send(packs);
  });

  app.post('/restaurants/:id/gift-card-packs', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const body = CreatePackSchema.parse(req.body);
    const pack = await service.create({ ...body, restaurantId });
    return reply.status(201).send(pack);
  });

  app.patch(
    '/restaurants/:id/gift-card-packs/:packId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, packId } = req.params as { id: string; packId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const body = UpdatePackSchema.parse(req.body);
      const pack = await service.update(packId, restaurantId, body);
      return reply.send(pack);
    },
  );

  app.post(
    '/restaurants/:id/gift-card-packs/:packId/toggle',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, packId } = req.params as { id: string; packId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const pack = await service.toggle(packId, restaurantId);
      return reply.send(pack);
    },
  );
}
