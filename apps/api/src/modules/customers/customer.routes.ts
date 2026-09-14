import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { db } from '../../shared/db/client';
import { redisCache } from '../../shared/redis/client';
import { requireOrg } from '../../plugins/clerk';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
  ToggleVipSchema,
  CustomerParamsSchema,
  CustomerQuerySchema,
} from './customer.schema';
import {
  normalizeCustomerEmail,
  normalizeCustomerPhone,
  upsertCustomerIdentity,
} from './customer-crm.service';
import { canViewSensitiveNotes } from './customer-privacy';

function canWriteCustomerNotes(siteRole: string | undefined): boolean {
  return siteRole === 'OWNER' || siteRole === 'MANAGER';
}

export async function customerRoutes(app: FastifyInstance) {
  app.get(
    '/customers',
    { preHandler: requireOrg(), config: { rateLimit: { max: 100, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const query = CustomerQuerySchema.parse(req.query);
      const restaurantId = req.restaurantId;
      const where: Prisma.CustomerWhereInput = { restaurantId };
      if (query.phone) where.phone = query.phone;

      const [customers, total, restaurant] = await Promise.all([
        db.customer.findMany({
          where,
          orderBy: { visitCount: 'desc' },
          take: query.limit,
          skip: query.offset,
        }),
        db.customer.count({ where }),
        db.restaurant.findUnique({
          where: { id: restaurantId },
          select: { crmSensitiveNoteRoles: true },
        }),
      ]);

      const canViewNotes = canViewSensitiveNotes(req.siteRole, restaurant?.crmSensitiveNoteRoles);
      return reply.send({
        data: customers.map((customer) => (canViewNotes ? customer : { ...customer, notes: null })),
        total,
        limit: query.limit,
        offset: query.offset,
      });
    },
  );

  app.post(
    '/customers',
    { preHandler: requireOrg(), config: { rateLimit: { max: 100, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = CreateCustomerSchema.parse(req.body);
      const restaurantId = req.restaurantId!;
      if (body.notes !== undefined && !canWriteCustomerNotes(req.siteRole)) {
        return reply.status(403).send({
          error: 'CUSTOMER_NOTES_WRITE_ROLE_REQUIRED',
          message: 'La modification des notes client est réservée aux responsables.',
        });
      }
      const emailNormalized = body.email ? normalizeCustomerEmail(body.email) : null;
      try {
        const customer = await db.customer.upsert({
          where: { restaurantId_phone: { restaurantId, phone: body.phone } },
          create: {
            restaurantId,
            phone: body.phone,
            ...(emailNormalized ? { emailNormalized } : {}),
            ...(body.birthMonth !== undefined ? { birthMonth: body.birthMonth } : {}),
            ...(body.birthDay !== undefined ? { birthDay: body.birthDay } : {}),
            ...(body.preferredLocale !== undefined
              ? { preferredLocale: body.preferredLocale }
              : {}),
            name: body.name,
            notes: body.notes,
            specialOccasion: body.specialOccasion,
            isVip: body.isVip,
          },
          update: {
            name: body.name,
            ...(emailNormalized ? { emailNormalized } : {}),
            ...(body.birthMonth !== undefined ? { birthMonth: body.birthMonth } : {}),
            ...(body.birthDay !== undefined ? { birthDay: body.birthDay } : {}),
            ...(body.preferredLocale !== undefined
              ? { preferredLocale: body.preferredLocale }
              : {}),
            notes: body.notes,
            specialOccasion: body.specialOccasion,
            isVip: body.isVip,
          },
        });
        try {
          const normalizedPhone = normalizeCustomerPhone(body.phone);
          if (normalizedPhone) {
            await upsertCustomerIdentity({
              restaurantId,
              customerId: customer.id,
              type: 'PHONE',
              value: body.phone,
              source: 'MANUAL',
            });
          }
          if (emailNormalized) {
            await upsertCustomerIdentity({
              restaurantId,
              customerId: customer.id,
              type: 'EMAIL',
              value: body.email!,
              source: 'MANUAL',
            });
          }
        } catch {
          // A collision remains visible to the duplicate-review workflow; it
          // must not roll back an otherwise valid legacy customer upsert.
        }
        return reply.status(201).send(customer);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
          return reply.status(409).send({ error: 'Customer already exists' });
        throw err;
      }
    },
  );

  app.patch(
    '/customers/:id',
    { preHandler: requireOrg(), config: { rateLimit: { max: 100, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = CustomerParamsSchema.parse(req.params);
      const restaurantId = req.restaurantId;
      const body = UpdateCustomerSchema.parse(req.body);
      if (body.notes !== undefined && !canWriteCustomerNotes(req.siteRole)) {
        return reply.status(403).send({
          error: 'CUSTOMER_NOTES_WRITE_ROLE_REQUIRED',
          message: 'La modification des notes client est réservée aux responsables.',
        });
      }
      const { email, ...rest } = body;
      const data = {
        ...rest,
        ...(email !== undefined
          ? { emailNormalized: email ? normalizeCustomerEmail(email) : null }
          : {}),
      };
      const updated = await db.customer.update({ where: { id, restaurantId }, data });
      if (email) {
        try {
          await upsertCustomerIdentity({
            restaurantId,
            customerId: updated.id,
            type: 'EMAIL',
            value: email,
            source: 'MANUAL',
          });
        } catch {
          // Keep the profile mutation available; an identity collision is a
          // merge candidate and is handled by CRM duplicate review.
        }
      }
      await redisCache.del(`customer:${updated.restaurantId}:${updated.phone}`);
      return reply.send(updated);
    },
  );

  app.delete(
    '/customers/:id',
    { preHandler: requireOrg(), config: { rateLimit: { max: 100, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = CustomerParamsSchema.parse(req.params);
      const restaurantId = req.restaurantId;
      await db.customer.delete({ where: { id, restaurantId } });
      return reply.status(204).send();
    },
  );

  app.post(
    '/customers/:id/vip',
    { preHandler: requireOrg(), config: { rateLimit: { max: 100, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { id } = CustomerParamsSchema.parse(req.params);
      const restaurantId = req.restaurantId;
      const { isVip } = ToggleVipSchema.parse(req.body);
      const updated = await db.customer.update({ where: { id, restaurantId }, data: { isVip } });
      await redisCache.del(`customer:${updated.restaurantId}:${updated.phone}`);
      return reply.send(updated);
    },
  );
}
