import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { requireCapability } from '../entitlements/entitlement.guard';
import { db } from '../../shared/db/client';
import {
  createCustomerSegment,
  CustomerSegmentDefinitionSchema,
  ensureSystemCustomerSegments,
  getSystemCustomerSegmentDescription,
  previewCustomerSegment,
  refreshCustomerSegment,
} from './customer-segment.service';

const SegmentIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const SegmentNameSchema = z.string().trim().min(1).max(100);
const PreviewBodySchema = z.object({
  definition: CustomerSegmentDefinitionSchema,
  sampleLimit: z.coerce.number().int().min(1).max(20).optional(),
});
const CreateBodySchema = z.object({
  name: SegmentNameSchema,
  definition: CustomerSegmentDefinitionSchema,
});
const UpdateBodySchema = z
  .object({
    name: SegmentNameSchema.optional(),
    definition: CustomerSegmentDefinitionSchema.optional(),
  })
  .refine((body) => body.name !== undefined || body.definition !== undefined, {
    message: 'name or definition is required',
  });

const requireMarketingSegments = [requireOrg(), requireCapability('marketing.segments')];

export async function customerSegmentRoutes(app: FastifyInstance) {
  app.post(
    '/marketing/segments/preview',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      const body = PreviewBodySchema.parse(request.body);
      const preview = await previewCustomerSegment({
        restaurantId: request.restaurantId!,
        definition: body.definition,
        sampleLimit: body.sampleLimit,
      });
      return reply.send(preview);
    },
  );

  app.post(
    '/marketing/segments',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      const body = CreateBodySchema.parse(request.body);
      const segment = await createCustomerSegment({
        restaurantId: request.restaurantId!,
        name: body.name,
        definition: body.definition,
        createdBy: request.userId ?? undefined,
      });
      return reply.status(201).send({ data: segment });
    },
  );

  app.get(
    '/marketing/segments',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      await ensureSystemCustomerSegments({ restaurantId: request.restaurantId! });
      const segments = await db.customerSegment.findMany({
        where: { restaurantId: request.restaurantId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      });
      return reply.send({
        data: segments.map((segment) => {
          const systemDescription = getSystemCustomerSegmentDescription(segment.systemKey);
          return {
            ...segment,
            ...(systemDescription ? { systemDescription } : {}),
          };
        }),
      });
    },
  );

  app.get(
    '/marketing/segments/:id',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      const { id } = SegmentIdParamsSchema.parse(request.params);
      const segment = await db.customerSegment.findFirst({
        where: { id, restaurantId: request.restaurantId },
      });
      if (!segment) return reply.status(404).send({ error: 'SEGMENT_NOT_FOUND' });
      return reply.send({ data: segment });
    },
  );

  app.post(
    '/marketing/segments/:id/refresh',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      const { id } = SegmentIdParamsSchema.parse(request.params);
      try {
        const result = await refreshCustomerSegment({
          restaurantId: request.restaurantId!,
          segmentId: id,
        });
        return reply.send({ data: result });
      } catch (error) {
        if (error instanceof Error && error.message === 'SEGMENT_NOT_FOUND') {
          return reply.status(404).send({ error: 'SEGMENT_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.patch(
    '/marketing/segments/:id',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      const { id } = SegmentIdParamsSchema.parse(request.params);
      const body = UpdateBodySchema.parse(request.body);
      const current = await db.customerSegment.findFirst({
        where: { id, restaurantId: request.restaurantId },
      });
      if (!current) return reply.status(404).send({ error: 'SEGMENT_NOT_FOUND' });
      const definition = body.definition
        ? CustomerSegmentDefinitionSchema.parse(body.definition)
        : current.definition;
      const segment = await db.customerSegment.update({
        where: { id: current.id },
        data: {
          ...(body.name === undefined ? {} : { name: body.name }),
          definition: definition as object,
          definitionVersion: body.definition ? { increment: 1 } : undefined,
          lastCount: null,
          lastEvaluatedAt: null,
        },
      });
      return reply.send({ data: segment });
    },
  );

  app.delete(
    '/marketing/segments/:id',
    { preHandler: requireMarketingSegments },
    async (request, reply) => {
      const { id } = SegmentIdParamsSchema.parse(request.params);
      const result = await db.customerSegment.deleteMany({
        where: { id, restaurantId: request.restaurantId, isSystem: false },
      });
      if (result.count === 0) return reply.status(404).send({ error: 'SEGMENT_NOT_FOUND' });
      return reply.send({ data: { deleted: true } });
    },
  );
}
