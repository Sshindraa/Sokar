import { FastifyInstance } from 'fastify';
import { z }              from 'zod';
import { db }             from '../../shared/db/client';
import { requireOrg }     from '../../plugins/clerk';

const CallQuerySchema = z.object({
  restaurantId: z.string(),
  limit:        z.coerce.number().int().min(1).max(100).default(50),
  offset:       z.coerce.number().int().min(0).default(0),
});

export async function callRoutes(app: FastifyInstance) {

  app.get('/calls', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId;
    const query = CallQuerySchema.parse(req.query);
    const { limit, offset } = query;

    const [calls, total] = await Promise.all([
      db.call.findMany({
        where: { restaurantId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.call.count({ where: { restaurantId } }),
    ]);

    return reply.send({
      data: calls,
      total,
      limit,
      offset,
    });
  });

  app.get('/calls/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;

    const call = await db.call.findUnique({
      where: { id, restaurantId },
      include: { latencyTrace: true },
    });

    if (!call) {
      return reply.status(404).send({ error: 'Call not found' });
    }

    return reply.send(call);
  });

  app.delete('/calls/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    await db.call.delete({ where: { id, restaurantId } });
    return reply.status(204).send();
  });
}
