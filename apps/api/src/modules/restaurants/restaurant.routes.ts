import { FastifyInstance } from 'fastify';
import { z }              from 'zod';
import { db }             from '../../shared/db/client';
import { redisCache }     from '../../shared/redis/client';
import { authGuard }      from '../../shared/security/auth.guard';

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

export async function restaurantRoutes(app: FastifyInstance) {

  app.post('/restaurants', { preHandler: authGuard }, async (req, reply) => {
    const body = CreateRestaurantSchema.parse(req.body);
    try {
      const restaurant = await db.restaurant.create({ data: body });
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

  app.get('/restaurants/:id', { preHandler: authGuard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send(
      await db.restaurant.findUniqueOrThrow({ where: { id }, include: { personality: true } })
    );
  });

  app.patch('/restaurants/:id', { preHandler: authGuard }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body   = CreateRestaurantSchema.partial().parse(req.body);
    const updated = await db.restaurant.update({ where: { id }, data: body });
    await redisCache.del(`phone:${updated.phoneNumber}`);
    return reply.send(updated);
  });
}
