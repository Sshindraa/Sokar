import { FastifyInstance } from 'fastify';
import { db }             from '../../shared/db/client';
import { redisCache }     from '../../shared/redis/client';
import { requireOrg }     from '../../plugins/clerk';
import { CreateCustomerSchema, UpdateCustomerSchema, ToggleVipSchema } from './customer.schema';

export async function customerRoutes(app: FastifyInstance) {

  app.get('/customers', { preHandler: requireOrg() }, async (req, reply) => {
    const { phone } = req.query as { phone?: string };
    const restaurantId = (req as any).restaurantId;
    const where: any = { restaurantId };
    if (phone) where.phone = phone;
    return reply.send(await db.customer.findMany({ where, orderBy: { visitCount: 'desc' }, take: 50 }));
  });

  app.post('/customers', { preHandler: requireOrg() }, async (req, reply) => {
    const body = CreateCustomerSchema.parse(req.body);
    try {
      const customer = await db.customer.upsert({
        where:  { restaurantId_phone: { restaurantId: body.restaurantId, phone: body.phone } },
        create: body,
        update: { name: body.name, notes: body.notes, specialOccasion: body.specialOccasion, isVip: body.isVip },
      });
      return reply.status(201).send(customer);
    } catch (err: any) {
      if (err.code === 'P2002') return reply.status(409).send({ error: 'Customer already exists' });
      throw err;
    }
  });

  app.patch('/customers/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id }  = req.params as { id: string };
    const body    = UpdateCustomerSchema.parse(req.body);
    const updated = await db.customer.update({ where: { id }, data: body });
    await redisCache.del(`customer:${updated.restaurantId}:${updated.phone}`);
    return reply.send(updated);
  });

  app.post('/customers/:id/vip', { preHandler: requireOrg() }, async (req, reply) => {
    const { id }    = req.params as { id: string };
    const { isVip } = ToggleVipSchema.parse(req.body);
    const updated   = await db.customer.update({ where: { id }, data: { isVip } });
    await redisCache.del(`customer:${updated.restaurantId}:${updated.phone}`);
    return reply.send(updated);
  });
}
