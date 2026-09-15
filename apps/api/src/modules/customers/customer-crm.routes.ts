import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { db } from '../../shared/db/client';
import { requireCapability, requireRuntimeFlag } from '../entitlements/entitlement.guard';
import {
  appendCustomerTimelineEvent,
  assignCustomerTag,
  buildCustomerTimelineDedupeKey,
  CUSTOMER_PREFERENCE_KEYS,
  CustomerMetricSnapshotRepairError,
  deleteCustomerPreference,
  normalizeCustomerPreferenceValue,
  previewCustomerMetricSnapshotRepair,
  repairCustomerMetricSnapshot,
  removeCustomerTag,
  upsertCustomerPreference,
  upsertCustomerTag,
} from './customer-crm.service';
import {
  CustomerMergeError,
  listCustomerDuplicates,
  listCustomerMergeAudits,
  mergeCustomerProfiles,
  previewCustomerMerge,
  type CustomerMergePreferenceResolution,
} from './customer-merge.service';
import {
  canViewSensitiveNotes,
  effectiveSensitiveNoteRoles,
  hasSensitiveNoteRoleOverride,
  SENSITIVE_NOTE_ROLE_ORDER,
} from './customer-privacy';

const CustomerIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const TimelineQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const CrmListQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  isVip: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  minHonored365d: z.coerce.number().int().min(0).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(128).optional(),
});

const DataSourceSchema = z.enum(['MANUAL', 'RESERVATION', 'VOICE_SUGGESTION', 'POS', 'IMPORT']);
const TagBodySchema = z.object({
  key: z.string().trim().min(2).max(64),
  label: z.string().trim().min(1).max(80),
  colorToken: z.string().trim().min(2).max(32).nullable().optional(),
  source: DataSourceSchema.default('MANUAL'),
  ruleId: z.string().trim().min(1).max(128).nullable().optional(),
  ruleVersion: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
});

const TagParamsSchema = CustomerIdParamsSchema.extend({ tagId: z.string().trim().min(1).max(128) });
const PreferenceParamsSchema = CustomerIdParamsSchema.extend({
  key: z.enum(CUSTOMER_PREFERENCE_KEYS),
});
const PreferenceBodySchema = z.object({
  value: z.unknown(),
  source: DataSourceSchema.default('MANUAL'),
  confidence: z.coerce.number().min(0).max(1).nullable().optional(),
  confirmedAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

const MergeSourcesSchema = z.object({
  sourceCustomerIds: z.array(z.string().trim().min(1).max(128)).min(1).max(5),
});
const MergeBodySchema = MergeSourcesSchema.extend({
  preferenceResolution: z
    .record(z.enum(['target', 'source', 'latest']))
    .optional()
    .default({}),
});
const DuplicateQuerySchema = z.object({
  minScore: z.coerce.number().int().min(0).max(100).default(60),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(300).optional(),
});
const MergeAuditQuerySchema = z.object({
  targetCustomerId: z.string().trim().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).max(128).optional(),
});
const ProjectionRepairPreviewQuerySchema = z.object({
  now: z.coerce.date().optional(),
});

const requireCrmAdvancedFeature = requireRuntimeFlag(
  'CRM_ADVANCED_ENABLED',
  'Le CRM avancé reste désactivé jusqu’à la qualification du chantier.',
  'CRM_ADVANCED_DISABLED',
);
const requireCrmAdvanced = [
  requireOrg(),
  requireCapability('customers.advanced'),
  requireCrmAdvancedFeature,
];

const SensitiveNoteRoleSchema = z.enum(['OWNER', 'MANAGER', 'STAFF', 'READ_ONLY', 'ORG_MEMBER']);
const SensitiveNoteRolesBodySchema = z
  .object({
    sensitiveNoteRoles: z.array(SensitiveNoteRoleSchema).min(1).max(6).nullable(),
  })
  .refine(
    ({ sensitiveNoteRoles }) => sensitiveNoteRoles === null || sensitiveNoteRoles.includes('OWNER'),
    { message: 'La liste doit toujours conserver le rôle OWNER.' },
  );

async function requireMergePreviewRole(
  request: { siteRole?: string },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'CRM_MERGE_ROLE_REQUIRED',
    message: 'La détection et la prévisualisation des fusions sont réservées aux responsables.',
  });
}

async function requireMergeOwnerRole(
  request: { siteRole?: string },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (request.siteRole === 'OWNER') return;
  return reply.status(403).send({
    error: 'CRM_MERGE_OWNER_REQUIRED',
    message: 'Seul le propriétaire du site peut confirmer une fusion client.',
  });
}

async function requireProjectionRepairOwnerRole(
  request: { siteRole?: string },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (request.siteRole === 'OWNER') return;
  return reply.status(403).send({
    error: 'CRM_PROJECTION_REPAIR_OWNER_REQUIRED',
    message: 'Seul le propriétaire du site peut réparer une projection CRM.',
  });
}

async function requireCrmWriteRole(
  request: { siteRole?: string },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'CRM_WRITE_ROLE_REQUIRED',
    message: 'La modification des préférences et tags CRM est réservée aux responsables.',
  });
}

async function requireCrmPrivacyOwner(
  request: { siteRole?: string },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (request.siteRole === 'OWNER') return;
  return reply.status(403).send({
    error: 'CRM_PRIVACY_OWNER_REQUIRED',
    message: 'Seul le propriétaire du site peut configurer la visibilité des notes CRM.',
  });
}

const requireCrmMergePreview = [
  requireOrg(),
  requireCapability('crm.merge'),
  requireCrmAdvancedFeature,
  requireMergePreviewRole,
];
const requireCrmMergeMutation = [
  requireOrg(),
  requireCapability('crm.merge'),
  requireCrmAdvancedFeature,
  requireMergeOwnerRole,
];
const requireCrmProjectionRepairPreview = [
  requireOrg(),
  requireCapability('customers.advanced'),
  requireCrmAdvancedFeature,
];
const requireCrmProjectionRepairMutation = [
  requireOrg(),
  requireCapability('customers.advanced'),
  requireCrmAdvancedFeature,
  requireProjectionRepairOwnerRole,
];
const requireCrmAdvancedWrite = [
  requireOrg(),
  requireCapability('customers.advanced'),
  requireCrmAdvancedFeature,
  requireCrmWriteRole,
];
const requireCrmPrivacy = [
  requireOrg(),
  requireCapability('customers.advanced'),
  requireCrmAdvancedFeature,
  requireCrmPrivacyOwner,
];

function mergeErrorResponse(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (!(error instanceof CustomerMergeError)) return null;
  const status =
    error.code === 'CUSTOMER_NOT_FOUND' || error.code === 'CRM_TENANT_MISMATCH'
      ? 404
      : error.code === 'CUSTOMER_NOT_ACTIVE' ||
          error.code === 'MERGE_IDENTITY_CONFLICT' ||
          error.code === 'MERGE_PREFERENCE_RESOLUTION_REQUIRED' ||
          error.code === 'MERGE_IDEMPOTENCY_KEY_REUSED'
        ? 409
        : 400;
  return reply.status(status).send({ error: error.code, message: error.message });
}

function projectionRepairErrorResponse(
  error: unknown,
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (!(error instanceof CustomerMetricSnapshotRepairError)) return null;
  const status =
    error.code === 'CUSTOMER_NOT_FOUND' || error.code === 'CRM_TENANT_MISMATCH'
      ? 404
      : error.code === 'CUSTOMER_NOT_ACTIVE' || error.code === 'IDEMPOTENCY_KEY_INVALID'
        ? 409
        : error.code === 'IDEMPOTENCY_KEY_REQUIRED'
          ? 400
          : 400;
  return reply.status(status).send({ error: error.code, message: error.message });
}

async function findActiveCustomer(id: string, restaurantId: string): Promise<boolean> {
  const customer = await db.customer.findFirst({
    where: { id, restaurantId, archivedAt: null },
    select: { id: true },
  });
  return Boolean(customer);
}

/** Read-only CRM profile endpoints backed by the additive M03 projections. */
export async function customerCrmRoutes(app: FastifyInstance) {
  app.get('/crm/privacy', { preHandler: requireCrmPrivacy }, async (request, reply) => {
    const site = await db.restaurant.findUnique({
      where: { id: request.restaurantId },
      select: { crmSensitiveNoteRoles: true },
    });
    if (!site) return reply.status(404).send({ error: 'RESTAURANT_NOT_FOUND' });
    return reply.send({
      data: {
        sensitiveNoteRoles: effectiveSensitiveNoteRoles(site.crmSensitiveNoteRoles),
        source: hasSensitiveNoteRoleOverride(site.crmSensitiveNoteRoles) ? 'SITE' : 'ENVIRONMENT',
      },
    });
  });

  app.patch('/crm/privacy', { preHandler: requireCrmPrivacy }, async (request, reply) => {
    const body = SensitiveNoteRolesBodySchema.parse(request.body);
    const roles = body.sensitiveNoteRoles
      ? [...new Set(body.sensitiveNoteRoles)].sort(
          (left, right) =>
            SENSITIVE_NOTE_ROLE_ORDER.indexOf(left) - SENSITIVE_NOTE_ROLE_ORDER.indexOf(right),
        )
      : null;
    const updated = await db.restaurant.update({
      where: { id: request.restaurantId },
      data: { crmSensitiveNoteRoles: roles?.join(',') ?? null },
      select: { crmSensitiveNoteRoles: true },
    });
    return reply.send({
      data: {
        sensitiveNoteRoles: effectiveSensitiveNoteRoles(updated.crmSensitiveNoteRoles),
        source: hasSensitiveNoteRoleOverride(updated.crmSensitiveNoteRoles)
          ? 'SITE'
          : 'ENVIRONMENT',
      },
    });
  });

  app.get('/crm/duplicates', { preHandler: requireCrmMergePreview }, async (request, reply) => {
    const query = DuplicateQuerySchema.parse(request.query);
    return reply.send(
      await listCustomerDuplicates({
        restaurantId: request.restaurantId!,
        minScore: query.minScore,
        limit: query.limit,
        cursor: query.cursor,
      }),
    );
  });

  app.get('/crm/merges', { preHandler: requireCrmMergePreview }, async (request, reply) => {
    const query = MergeAuditQuerySchema.parse(request.query);
    return reply.send(
      await listCustomerMergeAudits({
        restaurantId: request.restaurantId!,
        targetCustomerId: query.targetCustomerId,
        limit: query.limit,
        cursor: query.cursor,
      }),
    );
  });

  app.get(
    '/crm/customers/:id/projection-repair-preview',
    { preHandler: requireCrmProjectionRepairPreview },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      const query = ProjectionRepairPreviewQuerySchema.parse(request.query);
      try {
        return reply.send({
          data: await previewCustomerMetricSnapshotRepair({
            restaurantId: request.restaurantId!,
            customerId: id,
            now: query.now,
          }),
        });
      } catch (error) {
        const response = projectionRepairErrorResponse(error, reply);
        if (response) return response;
        throw error;
      }
    },
  );

  app.post(
    '/crm/customers/:id/projection-repair',
    { preHandler: requireCrmProjectionRepairMutation },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      const idempotencyHeader = request.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(idempotencyHeader)
        ? idempotencyHeader[0]
        : idempotencyHeader;
      try {
        const result = await repairCustomerMetricSnapshot({
          restaurantId: request.restaurantId!,
          customerId: id,
          idempotencyKey: idempotencyKey ?? '',
          actor: request.userId ?? undefined,
        });
        return reply.status(result.replayed ? 200 : 201).send({ data: result });
      } catch (error) {
        const response = projectionRepairErrorResponse(error, reply);
        if (response) return response;
        throw error;
      }
    },
  );

  app.post(
    '/crm/customers/:id/merge-preview',
    { preHandler: requireCrmMergePreview },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      const body = MergeSourcesSchema.parse(request.body);
      try {
        return reply.send({
          data: await previewCustomerMerge({
            restaurantId: request.restaurantId!,
            targetCustomerId: id,
            sourceCustomerIds: body.sourceCustomerIds,
          }),
        });
      } catch (error) {
        const response = mergeErrorResponse(error, reply);
        if (response) return response;
        throw error;
      }
    },
  );

  app.post(
    '/crm/customers/:id/merge',
    { preHandler: requireCrmMergeMutation },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      const body = MergeBodySchema.parse(request.body);
      const idempotencyHeader = request.headers['idempotency-key'];
      const idempotencyKey = Array.isArray(idempotencyHeader)
        ? idempotencyHeader[0]
        : idempotencyHeader;
      try {
        const result = await mergeCustomerProfiles({
          restaurantId: request.restaurantId!,
          targetCustomerId: id,
          sourceCustomerIds: body.sourceCustomerIds,
          preferenceResolution: body.preferenceResolution as Record<
            string,
            CustomerMergePreferenceResolution
          >,
          actor: request.userId ?? undefined,
          idempotencyKey: idempotencyKey ?? '',
        });
        return reply.status(result.replayed ? 200 : 201).send({ data: result });
      } catch (error) {
        const response = mergeErrorResponse(error, reply);
        if (response) return response;
        throw error;
      }
    },
  );

  app.get('/crm/customers', { preHandler: requireCrmAdvanced }, async (request, reply) => {
    const query = CrmListQuerySchema.parse(request.query);
    const where = {
      restaurantId: request.restaurantId,
      archivedAt: null,
      ...(query.isVip === undefined ? {} : { isVip: query.isVip }),
      ...(query.minHonored365d === undefined
        ? {}
        : { metricSnapshot: { honored365d: { gte: query.minHonored365d } } }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { phone: { contains: query.search } },
              { emailNormalized: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const customers = await db.customer.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      include: { metricSnapshot: true },
    });
    const hasNextPage = customers.length > query.limit;
    const page = hasNextPage ? customers.slice(0, query.limit) : customers;
    const nextCursor = hasNextPage ? (page[page.length - 1]?.id ?? null) : null;
    return reply.send({ data: page, nextCursor });
  });

  app.get('/crm/customers/:id', { preHandler: requireCrmAdvanced }, async (request, reply) => {
    const { id } = CustomerIdParamsSchema.parse(request.params);
    const customer = await db.customer.findFirst({
      where: { id, restaurantId: request.restaurantId, archivedAt: null },
      include: {
        restaurant: { select: { crmSensitiveNoteRoles: true } },
        identities: {
          select: {
            id: true,
            type: true,
            value: true,
            normalizedValue: true,
            verifiedAt: true,
            source: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        metricSnapshot: true,
        preferences: {
          orderBy: { key: 'asc' },
        },
        tagAssignments: {
          include: { tag: true },
          orderBy: { assignedAt: 'asc' },
        },
        timelineEvents: {
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: 50,
        },
      },
    });
    if (!customer) {
      return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
    }

    const canViewNotes = canViewSensitiveNotes(
      request.siteRole,
      customer.restaurant?.crmSensitiveNoteRoles,
    );
    return reply.send({
      data: {
        ...customer,
        notes: canViewNotes ? customer.notes : null,
        metrics: customer.metricSnapshot,
        preferences: customer.preferences,
        tags: customer.tagAssignments.map((assignment) => assignment.tag),
        tagAssignments: customer.tagAssignments,
        timeline: customer.timelineEvents.map((event) =>
          canViewNotes ? event : { ...event, metadata: {} },
        ),
      },
    });
  });

  app.get(
    '/crm/customers/:id/timeline',
    { preHandler: requireCrmAdvanced },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      const query = TimelineQuerySchema.parse(request.query);
      const customer = await db.customer.findFirst({
        where: { id, restaurantId: request.restaurantId, archivedAt: null },
        select: { id: true, restaurant: { select: { crmSensitiveNoteRoles: true } } },
      });
      if (!customer) {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }

      const events = await db.customerTimelineEvent.findMany({
        where: { restaurantId: request.restaurantId, customerId: id },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        take: query.limit + 1,
      });
      const hasNextPage = events.length > query.limit;
      const page = hasNextPage ? events.slice(0, query.limit) : events;
      const nextCursor = hasNextPage ? (page[page.length - 1]?.id ?? null) : null;
      const canViewNotes = canViewSensitiveNotes(
        request.siteRole,
        customer.restaurant?.crmSensitiveNoteRoles,
      );
      return reply.send({
        data: page.map((event) => (canViewNotes ? event : { ...event, metadata: {} })),
        nextCursor,
      });
    },
  );

  app.get('/crm/tags', { preHandler: requireCrmAdvanced }, async (request, reply) => {
    const tags = await db.customerTag.findMany({
      where: { restaurantId: request.restaurantId },
      orderBy: [{ isSystem: 'desc' }, { label: 'asc' }],
      include: { _count: { select: { assignments: true } } },
    });
    return reply.send({ data: tags });
  });

  app.post(
    '/crm/customers/:id/tags',
    { preHandler: requireCrmAdvancedWrite },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      const body = TagBodySchema.parse(request.body);
      const restaurantId = request.restaurantId!;
      if (!(await findActiveCustomer(id, restaurantId))) {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }
      const tag = await upsertCustomerTag({
        restaurantId,
        key: body.key,
        label: body.label,
        colorToken: body.colorToken,
      });
      const result = await assignCustomerTag({
        restaurantId,
        customerId: id,
        tagId: tag.id,
        source: body.source,
        ruleId: body.ruleId,
        ruleVersion: body.ruleVersion,
      });
      if (result.created) {
        const assignmentTimestamp =
          result.assignment.assignedAt instanceof Date
            ? result.assignment.assignedAt.toISOString()
            : new Date().toISOString();
        await appendCustomerTimelineEvent({
          restaurantId,
          customerId: id,
          eventType: 'CUSTOMER_TAG_ASSIGNED',
          sourceType: 'customer_tag',
          sourceId: `${tag.id}:${assignmentTimestamp}`,
          dedupeKey: buildCustomerTimelineDedupeKey({
            restaurantId,
            customerId: id,
            eventType: 'CUSTOMER_TAG_ASSIGNED',
            sourceType: 'customer_tag',
            sourceId: `${tag.id}:${assignmentTimestamp}`,
          }),
          summaryCode: 'customer.tag_assigned',
          metadata: { tagKey: tag.key, source: body.source },
        });
      }
      return reply
        .status(result.created ? 201 : 200)
        .send({ data: { tag, assignment: result.assignment } });
    },
  );

  app.delete(
    '/crm/customers/:id/tags/:tagId',
    { preHandler: requireCrmAdvancedWrite },
    async (request, reply) => {
      const { id, tagId } = TagParamsSchema.parse(request.params);
      const restaurantId = request.restaurantId!;
      if (!(await findActiveCustomer(id, restaurantId))) {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }
      const removed = await removeCustomerTag({ restaurantId, customerId: id, tagId });
      if (!removed) return reply.status(404).send({ error: 'TAG_ASSIGNMENT_NOT_FOUND' });
      const removalTimestamp = new Date().toISOString();
      await appendCustomerTimelineEvent({
        restaurantId,
        customerId: id,
        eventType: 'CUSTOMER_TAG_REMOVED',
        sourceType: 'customer_tag',
        sourceId: `${tagId}:${removalTimestamp}`,
        dedupeKey: buildCustomerTimelineDedupeKey({
          restaurantId,
          customerId: id,
          eventType: 'CUSTOMER_TAG_REMOVED',
          sourceType: 'customer_tag',
          sourceId: `${tagId}:${removalTimestamp}`,
        }),
        summaryCode: 'customer.tag_removed',
        metadata: { tagId },
      });
      return reply.send({ data: { removed: true } });
    },
  );

  app.put(
    '/crm/customers/:id/preferences/:key',
    { preHandler: requireCrmAdvancedWrite },
    async (request, reply) => {
      const { id, key } = PreferenceParamsSchema.parse(request.params);
      const body = PreferenceBodySchema.parse(request.body);
      const restaurantId = request.restaurantId!;
      if (!(await findActiveCustomer(id, restaurantId))) {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }
      const preference = await upsertCustomerPreference({
        restaurantId,
        customerId: id,
        key,
        value: normalizeCustomerPreferenceValue(body.value),
        source: body.source,
        confidence: body.confidence,
        confirmedAt: body.confirmedAt,
        expiresAt: body.expiresAt,
      });
      const preferenceTimestamp =
        preference.updatedAt instanceof Date
          ? preference.updatedAt.toISOString()
          : new Date().toISOString();
      await appendCustomerTimelineEvent({
        restaurantId,
        customerId: id,
        eventType: 'CUSTOMER_PREFERENCE_UPDATED',
        sourceType: 'customer_preference',
        sourceId: `${preference.id}:${preferenceTimestamp}`,
        dedupeKey: buildCustomerTimelineDedupeKey({
          restaurantId,
          customerId: id,
          eventType: 'CUSTOMER_PREFERENCE_UPDATED',
          sourceType: 'customer_preference',
          sourceId: `${preference.id}:${preferenceTimestamp}`,
        }),
        summaryCode: 'customer.preference_updated',
        metadata: { preferenceKey: preference.key, source: body.source },
      });
      return reply.send({ data: preference });
    },
  );

  app.delete(
    '/crm/customers/:id/preferences/:key',
    { preHandler: requireCrmAdvancedWrite },
    async (request, reply) => {
      const { id, key } = PreferenceParamsSchema.parse(request.params);
      const restaurantId = request.restaurantId!;
      if (!(await findActiveCustomer(id, restaurantId))) {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }
      const removed = await deleteCustomerPreference({ restaurantId, customerId: id, key });
      if (!removed) return reply.status(404).send({ error: 'PREFERENCE_NOT_FOUND' });
      const removalTimestamp = new Date().toISOString();
      await appendCustomerTimelineEvent({
        restaurantId,
        customerId: id,
        eventType: 'CUSTOMER_PREFERENCE_REMOVED',
        sourceType: 'customer_preference',
        sourceId: `${key}:${removalTimestamp}`,
        dedupeKey: buildCustomerTimelineDedupeKey({
          restaurantId,
          customerId: id,
          eventType: 'CUSTOMER_PREFERENCE_REMOVED',
          sourceType: 'customer_preference',
          sourceId: `${key}:${removalTimestamp}`,
        }),
        summaryCode: 'customer.preference_removed',
        metadata: { preferenceKey: key },
      });
      return reply.send({ data: { removed: true } });
    },
  );
}
