import { FastifyInstance } from 'fastify';
import { z }              from 'zod';
import { requireOrg }     from '../../plugins/clerk';

const CreateRestaurantSchema = z.object({
  name:         z.string().min(2).max(100),
  managerPhone: z.string().regex(/^\+?[0-9]{10,15}$/),
  managerEmail: z.string().email(),
  phoneNumber:  z.string().min(5),
  openingHours: z.record(
    z.enum(['mon','tue','wed','thu','fri','sat','sun']),
    z.union([z.object({ open: z.string(), close: z.string() }), z.null()])
  ),
  plan: z.enum(['STARTER', 'PRO', 'PREMIUM']).default('STARTER'),
});

const UpdatePersonalitySchema = z.object({
  profileType:       z.enum(['BISTROT_BRASSERIE', 'GASTRONOMIQUE', 'SEMI_GASTRO']).optional(),
  fillerStyle:       z.enum(['CASUAL', 'FORMAL', 'WARM']).optional(),
  speakingRate:      z.number().min(0.5).max(2.0).optional(),
  voiceIdCa:         z.string().optional(),
  systemPromptExtra: z.string().max(2000).optional(),
});

export async function restaurantRoutes(app: FastifyInstance) {

  app.post('/restaurants', { preHandler: requireOrg() }, async (req, reply) => {
    const body = CreateRestaurantSchema.parse(req.body);
    try {
      const restaurant = await app.db.restaurant.create({ data: body as any });
      await app.queues.eveningReport.upsertJobScheduler(
        `nightly-${restaurant.id}`,
        { pattern: '0 23 * * *', tz: 'Europe/Paris' },
        { name: 'nightly', data: { restaurantId: restaurant.id } }
      );
      return reply.status(201).send(restaurant);
    } catch (err: any) {
      if (err.code === 'P2002') {
        return reply.status(409).send({ error: 'Phone number already registered' });
      }
      throw err;
    }
  });

  app.get('/restaurants/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = (req as any).restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    return reply.send(
      await app.db.restaurant.findUniqueOrThrow({ where: { id }, include: { personality: true } })
    );
  });

  app.patch('/restaurants/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = (req as any).restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body   = CreateRestaurantSchema.partial().parse(req.body);
    const updated = await app.db.restaurant.update({ where: { id }, data: body });
    await app.redisCache.del(`phone:${updated.phoneNumber}`);
    return reply.send(updated);
  });

  // ─── Personnalité de l'agent vocal ─────────────────────────────

  app.get('/restaurants/:id/personality', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = (req as any).restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const personality = await app.db.agentPersonality.findUnique({ where: { restaurantId: id } });
    return reply.send(personality ?? {});
  });

  app.patch('/restaurants/:id/personality', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = (req as any).restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = UpdatePersonalitySchema.parse(req.body);

    const personality = await app.db.agentPersonality.upsert({
      where:  { restaurantId: id },
      create: { restaurantId: id, ...body },
      update: body,
    });

    // Invalider le cache du restaurant pour que le nouveau system prompt soit pris en compte
    const restaurant = await app.db.restaurant.findUniqueOrThrow({ where: { id } });
    await app.redisCache.del(`phone:${restaurant.phoneNumber}`);

    return reply.send(personality);
  });
}
