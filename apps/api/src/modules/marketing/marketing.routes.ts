import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MarketingCampaignStatus } from '@prisma/client';
import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { requireOrg } from '../../plugins/clerk';
import { requireCapability, requireRuntimeFlag } from '../entitlements/entitlement.guard';
import { CustomerSegmentDefinitionSchema } from '../customers/customer-segment.service';
import {
  CAMPAIGN_CHANNELS,
  cancelMarketingCampaign,
  createMarketingCampaign,
  getMarketingCampaign,
  listMarketingCampaigns,
  prepareMarketingCampaign,
  previewMarketingAudience,
  previewMarketingCampaign,
  scheduleMarketingCampaign,
  startMarketingCampaign,
  testMarketingCampaign,
  updateMarketingCampaign,
} from './marketing-campaign.service';
import {
  listMarketingAutomations,
  MARKETING_AUTOMATION_TYPES,
  upsertMarketingAutomation,
} from './marketing-automation.service';
import {
  createMarketingAttributionLink,
  deactivateMarketingConversions,
  defaultAttributionExpiry,
  recordMarketingAttributionClick,
  recordMarketingConversion,
} from './marketing-attribution.service';
import {
  listMarketingPermissions,
  MARKETING_CHANNELS,
  upsertMarketingPermission,
  withdrawMarketingPermission,
} from './marketing-permission.service';
import { consumeMarketingUnsubscribeToken } from './marketing-unsubscribe.service';
import {
  getMarketingCampaignReport,
  marketingCampaignReportToCsv,
} from './marketing-report.service';
import { getMarketingProviderReadiness } from './marketing-provider.service';
import { RATE_LIMIT_PUBLIC_TOKEN } from '../../plugins/rate-limit.policy';

/**
 * Public token endpoints (attribution click, unsubscribe). They are
 * unauthenticated and guarded only by an opaque token, so they use the
 * stricter `PUBLIC_TOKEN` tier instead of the global budget.
 */
const publicTokenRouteOptions = {
  config: { rateLimit: RATE_LIMIT_PUBLIC_TOKEN },
};

const CustomerIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});
const ChannelParamsSchema = CustomerIdParamsSchema.extend({
  channel: z.enum(MARKETING_CHANNELS),
});
const PermissionBodySchema = z.object({
  status: z.enum(['OPTED_IN', 'OPTED_OUT', 'UNKNOWN']),
  source: z.string().trim().min(1).max(80),
  proofVersion: z.string().trim().min(1).max(80).nullable().optional(),
  proof: z.string().trim().min(1).max(512).nullable().optional(),
  proofHash: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/)
    .nullable()
    .optional(),
});

const AudiencePreviewSchema = z
  .object({
    channel: z.enum(CAMPAIGN_CHANNELS),
    segmentId: z.string().trim().min(1).max(128).optional(),
    definition: CustomerSegmentDefinitionSchema.optional(),
    sampleLimit: z.coerce.number().int().min(1).max(20).optional(),
  })
  .refine((body) => Boolean(body.segmentId) !== (body.definition !== undefined), {
    message: 'segmentId or definition is required, but not both',
    path: ['segmentId'],
  });

const CampaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  objective: z.string().trim().min(1).max(120),
  channel: z.enum(CAMPAIGN_CHANNELS),
  segmentId: z.string().trim().min(1).max(128),
  subject: z.string().trim().min(1).max(200).nullable().optional(),
  bodyTemplate: z.string().trim().min(1).max(10_000),
  scheduledAt: z.coerce.date().nullable().optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
});
const CampaignUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    objective: z.string().trim().min(1).max(120).optional(),
    channel: z.enum(CAMPAIGN_CHANNELS).optional(),
    segmentId: z.string().trim().min(1).max(128).optional(),
    subject: z.string().trim().min(1).max(200).nullable().optional(),
    bodyTemplate: z.string().trim().min(1).max(10_000).optional(),
    scheduledAt: z.coerce.date().nullable().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

const CampaignIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});
const CampaignListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const AutomationTypeParamsSchema = z.object({
  type: z.enum(MARKETING_AUTOMATION_TYPES),
});
const AutomationUpsertSchema = z.object({
  enabled: z.boolean(),
  channel: z.enum(CAMPAIGN_CHANNELS),
  config: z.record(z.unknown()),
});
const CampaignScheduleBodySchema = z.object({
  scheduledAt: z.coerce.date(),
});
const AttributionLinkBodySchema = z.object({
  customerId: z.string().trim().min(1).max(128),
  expiresAt: z.coerce.date().optional(),
});
const ConversionBodySchema = z.object({
  customerId: z.string().trim().min(1).max(128),
  reservationId: z.string().trim().min(1).max(128).nullable().optional(),
  conversionType: z.enum(['RESERVATION_CREATED', 'RESERVATION_HONORED']),
  attributedAt: z.coerce.date().optional(),
  windowEndsAt: z.coerce.date().nullable().optional(),
});
const ClickBodySchema = z.object({
  token: z.string().trim().min(20).max(4096),
});
const DeactivateConversionBodySchema = z.object({
  reservationId: z.string().trim().min(1).max(128),
});

const requireCrmAdvancedFeature = requireRuntimeFlag(
  'CRM_ADVANCED_ENABLED',
  'Le CRM avancé reste désactivé jusqu’à la qualification du chantier.',
  'CRM_ADVANCED_DISABLED',
);
const requireMarketingFeature = requireRuntimeFlag(
  'MARKETING_FEATURES_ENABLED',
  'Les campagnes et segments restent désactivés jusqu’à la qualification du pilote.',
  'MARKETING_FEATURES_DISABLED',
);
const requireCrmAdvanced = [
  requireOrg(),
  requireCapability('customers.advanced'),
  requireCrmAdvancedFeature,
];
const requireMarketingCampaigns = [
  requireOrg(),
  requireCapability('marketing.campaigns'),
  requireMarketingFeature,
];
const requireMarketingAutomations = [
  requireOrg(),
  requireCapability('marketing.automations'),
  requireMarketingFeature,
];
const requireMarketingAttribution = [
  requireOrg(),
  requireCapability('marketing.attribution'),
  requireMarketingFeature,
];

function statusForError(error: unknown): number {
  if (!(error instanceof Error)) return 500;
  if (error.message === 'CUSTOMER_NOT_FOUND' || error.message === 'SEGMENT_NOT_FOUND') return 404;
  if (error.message === 'CAMPAIGN_NOT_FOUND') return 404;
  if (
    error.message === 'CAMPAIGN_NOT_DRAFT' ||
    error.message === 'CAMPAIGN_NOT_CANCELLABLE' ||
    error.message === 'AUDIENCE_EMPTY' ||
    error.message === 'CAMPAIGN_NOT_READY' ||
    error.message === 'CAMPAIGN_ALREADY_RUNNING' ||
    error.message === 'CAMPAIGN_NOT_DUE'
  ) {
    return 409;
  }
  if (error.message === 'MARKETING_SENDS_DISABLED') return 503;
  if (error.message === 'MARKETING_QUEUE_ENQUEUE_UNKNOWN') return 503;
  if (error.message.startsWith('AUTOMATION_CANDIDATES_TOO_LARGE:')) return 413;
  if (error.message.startsWith('AUDIENCE_TOO_LARGE:')) return 413;
  if (
    error.message === 'ATTRIBUTION_SECRET_NOT_CONFIGURED' ||
    error.message === 'INVALID_ATTRIBUTION_TOKEN' ||
    error.message === 'ATTRIBUTION_TOKEN_EXPIRED'
  ) {
    return 400;
  }
  return 400;
}

/** Channel-specific permission and durable campaign control plane. */
export async function marketingRoutes(app: FastifyInstance) {
  app.get(
    '/marketing/providers/readiness',
    { preHandler: requireMarketingCampaigns },
    async (_request, reply) => reply.send({ data: getMarketingProviderReadiness() }),
  );

  app.get(
    '/crm/customers/:id/marketing-permissions',
    { preHandler: requireCrmAdvanced },
    async (request, reply) => {
      const { id } = CustomerIdParamsSchema.parse(request.params);
      try {
        const permissions = await listMarketingPermissions({
          restaurantId: request.restaurantId!,
          customerId: id,
        });
        return reply.send({ data: permissions });
      } catch (error) {
        if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
          return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.put(
    '/crm/customers/:id/marketing-permissions/:channel',
    { preHandler: requireCrmAdvanced },
    async (request, reply) => {
      const { id, channel } = ChannelParamsSchema.parse(request.params);
      const body = PermissionBodySchema.parse(request.body);
      try {
        const permission = await upsertMarketingPermission({
          restaurantId: request.restaurantId!,
          customerId: id,
          channel,
          status: body.status,
          source: body.source,
          proofVersion: body.proofVersion,
          proof: body.proof,
          proofHash: body.proofHash,
          occurredAt: new Date(),
        });
        return reply.send({ data: permission });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'CUSTOMER_NOT_FOUND' });
        throw error;
      }
    },
  );

  app.delete(
    '/crm/customers/:id/marketing-permissions/:channel',
    { preHandler: requireCrmAdvanced },
    async (request, reply) => {
      const { id, channel } = ChannelParamsSchema.parse(request.params);
      try {
        const permission = await withdrawMarketingPermission({
          restaurantId: request.restaurantId!,
          customerId: id,
          channel,
          source: 'UNSUBSCRIBE',
        });
        return reply.send({ data: permission });
      } catch (error) {
        if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
          return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.get(
    '/marketing/automations',
    { preHandler: requireMarketingAutomations },
    async (request, reply) => {
      const automations = await listMarketingAutomations({ restaurantId: request.restaurantId! });
      return reply.send({ data: automations });
    },
  );

  app.put(
    '/marketing/automations/:type',
    { preHandler: requireMarketingAutomations },
    async (request, reply) => {
      const { type } = AutomationTypeParamsSchema.parse(request.params);
      const body = AutomationUpsertSchema.parse(request.body);
      const automation = await upsertMarketingAutomation({
        restaurantId: request.restaurantId!,
        type,
        channel: body.channel,
        config: body.config,
        enabled: body.enabled,
      });
      return reply.send({ data: automation });
    },
  );

  app.post(
    '/marketing/campaigns/audience-preview',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const body = AudiencePreviewSchema.parse(request.body);
      try {
        const preview = await previewMarketingAudience({
          restaurantId: request.restaurantId!,
          channel: body.channel,
          segmentId: body.segmentId,
          definition: body.definition,
          sampleLimit: body.sampleLimit,
        });
        return reply.send(preview);
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'SEGMENT_NOT_FOUND' });
        if (status === 413) return reply.status(status).send({ error: 'AUDIENCE_TOO_LARGE' });
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const body = CampaignCreateSchema.parse(request.body);
      try {
        const campaign = await createMarketingCampaign({
          restaurantId: request.restaurantId!,
          name: body.name,
          objective: body.objective,
          channel: body.channel,
          segmentId: body.segmentId,
          subject: body.subject,
          bodyTemplate: body.bodyTemplate,
          scheduledAt: body.scheduledAt,
          timezone: body.timezone,
          createdBy: request.userId ?? undefined,
        });
        return reply.status(201).send({ data: campaign });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'SEGMENT_NOT_FOUND' });
        if (status === 413) return reply.status(status).send({ error: 'AUDIENCE_TOO_LARGE' });
        throw error;
      }
    },
  );

  app.get(
    '/marketing/campaigns',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const query = CampaignListQuerySchema.parse(request.query);
      const campaigns = await listMarketingCampaigns({
        restaurantId: request.restaurantId!,
        limit: query.limit,
      });
      return reply.send({ data: campaigns });
    },
  );

  app.get(
    '/marketing/campaigns/:id',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      const campaign = await getMarketingCampaign({
        restaurantId: request.restaurantId!,
        campaignId: id,
      });
      if (!campaign) return reply.status(404).send({ error: 'CAMPAIGN_NOT_FOUND' });
      return reply.send({ data: campaign });
    },
  );

  app.patch(
    '/marketing/campaigns/:id',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      const body = CampaignUpdateSchema.parse(request.body);
      try {
        const campaign = await updateMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
          changes: body,
        });
        return reply.send({ data: campaign });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'CAMPAIGN_NOT_FOUND' });
        if (error instanceof Error && error.message === 'CAMPAIGN_NOT_EDITABLE') {
          return reply.status(409).send({ error: error.message });
        }
        if (error instanceof Error && error.message === 'CAMPAIGN_AUDIENCE_FROZEN') {
          return reply.status(409).send({ error: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/preview',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      try {
        const preview = await previewMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        return reply.send({ data: preview });
      } catch (error) {
        if (error instanceof Error && error.message === 'CAMPAIGN_NOT_FOUND') {
          return reply.status(404).send({ error: 'CAMPAIGN_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/test',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      try {
        const result = await testMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        return reply.send({ data: result });
      } catch (error) {
        if (error instanceof Error && error.message === 'CAMPAIGN_NOT_FOUND') {
          return reply.status(404).send({ error: 'CAMPAIGN_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.get(
    '/marketing/campaigns/:id/report',
    { preHandler: requireMarketingAttribution },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      try {
        const report = await getMarketingCampaignReport({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        return reply.send({ data: report });
      } catch (error) {
        if (error instanceof Error && error.message === 'CAMPAIGN_NOT_FOUND') {
          return reply.status(404).send({ error: 'CAMPAIGN_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.get(
    '/marketing/campaigns/:id/report.csv',
    { preHandler: requireMarketingAttribution },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      try {
        const report = await getMarketingCampaignReport({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        return reply
          .type('text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="sokar-campaign-${id}.csv"`)
          .send(marketingCampaignReportToCsv(report));
      } catch (error) {
        if (error instanceof Error && error.message === 'CAMPAIGN_NOT_FOUND') {
          return reply.status(404).send({ error: 'CAMPAIGN_NOT_FOUND' });
        }
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/prepare',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      try {
        const campaign = await prepareMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        return reply.send({ data: campaign });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'CAMPAIGN_NOT_FOUND' });
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/cancel',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      try {
        const campaign = await cancelMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        return reply.send({ data: campaign });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'CAMPAIGN_NOT_FOUND' });
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/schedule',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      const body = CampaignScheduleBodySchema.parse(request.body);
      if (process.env.MARKETING_SENDS_ENABLED !== 'true') {
        return reply.status(503).send({ error: 'MARKETING_SENDS_DISABLED' });
      }
      try {
        const campaign = await scheduleMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
          scheduledAt: body.scheduledAt,
        });
        const delay = Math.max(body.scheduledAt.getTime() - Date.now(), 0);
        try {
          await queues.marketingCampaign.add(
            'send-campaign',
            { campaignId: id, restaurantId: request.restaurantId! },
            { jobId: `marketing-campaign:${id}`, delay },
          );
        } catch (error) {
          await db.marketingCampaign.update({
            where: { id: campaign.id },
            data: {
              status: MarketingCampaignStatus.FAILED,
              completedAt: new Date(),
              lastErrorCode: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN',
            },
          });
          throw new Error('MARKETING_QUEUE_ENQUEUE_UNKNOWN', { cause: error });
        }
        return reply.send({ data: campaign });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'CAMPAIGN_NOT_FOUND' });
        if (status === 503)
          return reply.status(status).send({ error: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN' });
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/send',
    { preHandler: requireMarketingCampaigns },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      if (process.env.MARKETING_SENDS_ENABLED !== 'true') {
        return reply.status(503).send({ error: 'MARKETING_SENDS_DISABLED' });
      }
      try {
        const campaign = await startMarketingCampaign({
          restaurantId: request.restaurantId!,
          campaignId: id,
        });
        try {
          await queues.marketingCampaign.add(
            'send-campaign',
            { campaignId: id, restaurantId: request.restaurantId! },
            { jobId: `marketing-campaign:${id}` },
          );
        } catch (error) {
          await db.marketingCampaign.update({
            where: { id: campaign.id },
            data: {
              status: MarketingCampaignStatus.FAILED,
              completedAt: new Date(),
              lastErrorCode: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN',
            },
          });
          throw new Error('MARKETING_QUEUE_ENQUEUE_UNKNOWN', { cause: error });
        }
        return reply.send({ data: campaign });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) return reply.status(status).send({ error: 'CAMPAIGN_NOT_FOUND' });
        if (status === 503)
          return reply.status(status).send({ error: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN' });
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/attribution-links',
    { preHandler: requireMarketingAttribution },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      const body = AttributionLinkBodySchema.parse(request.body);
      try {
        const link = await createMarketingAttributionLink({
          restaurantId: request.restaurantId!,
          campaignId: id,
          customerId: body.customerId,
          expiresAt: body.expiresAt ?? defaultAttributionExpiry(),
        });
        return reply.status(201).send({
          data: {
            token: link.token,
            link: {
              id: link.link.id,
              campaignId: link.link.campaignId,
              customerId: link.link.customerId,
              expiresAt: link.link.expiresAt,
            },
          },
        });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) {
          const errorCode =
            error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND'
              ? 'CUSTOMER_NOT_FOUND'
              : 'CAMPAIGN_NOT_FOUND';
          return reply.status(status).send({ error: errorCode });
        }
        throw error;
      }
    },
  );

  // Public click endpoint: it records only a timestamp and never returns the
  // campaign or customer identifiers to the browser.
  app.post('/marketing/attribution/click', publicTokenRouteOptions, async (request, reply) => {
    const body = ClickBodySchema.parse(request.body);
    try {
      const link = await recordMarketingAttributionClick({ token: body.token });
      return reply.send({ data: { clicked: Boolean(link) } });
    } catch (error) {
      const status = statusForError(error);
      if (status === 400) return reply.status(400).send({ error: 'INVALID_ATTRIBUTION_TOKEN' });
      throw error;
    }
  });

  // One-click unsubscribe endpoint. The token carries only opaque tenant and
  // customer identifiers and is verified before changing the permission.
  app.post('/marketing/unsubscribe', publicTokenRouteOptions, async (request, reply) => {
    const body = z.object({ token: z.string().trim().min(20).max(4096) }).parse(request.body);
    try {
      const result = await consumeMarketingUnsubscribeToken({ token: body.token });
      return reply.send({ data: { unsubscribed: true, channel: result.channel } });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'INVALID_UNSUBSCRIBE_TOKEN' ||
          error.message === 'UNSUBSCRIBE_TOKEN_EXPIRED' ||
          error.message === 'MARKETING_UNSUBSCRIBE_SECRET_NOT_CONFIGURED')
      ) {
        return reply.status(400).send({ error: 'INVALID_UNSUBSCRIBE_TOKEN' });
      }
      if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }
      throw error;
    }
  });

  // The same token is accepted through GET so the URL included in an SMS or
  // email is actionable in a browser. The response remains deliberately
  // minimal and never echoes a phone number or email address.
  app.get('/marketing/unsubscribe', publicTokenRouteOptions, async (request, reply) => {
    const query = z.object({ token: z.string().trim().min(20).max(4096) }).parse(request.query);
    try {
      const result = await consumeMarketingUnsubscribeToken({ token: query.token });
      return reply.send({ data: { unsubscribed: true, channel: result.channel } });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'INVALID_UNSUBSCRIBE_TOKEN' ||
          error.message === 'UNSUBSCRIBE_TOKEN_EXPIRED' ||
          error.message === 'MARKETING_UNSUBSCRIBE_SECRET_NOT_CONFIGURED')
      ) {
        return reply.status(400).send({ error: 'INVALID_UNSUBSCRIBE_TOKEN' });
      }
      if (error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND') {
        return reply.status(404).send({ error: 'CUSTOMER_NOT_FOUND' });
      }
      throw error;
    }
  });

  app.post(
    '/marketing/campaigns/:id/conversions',
    { preHandler: requireMarketingAttribution },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      const body = ConversionBodySchema.parse(request.body);
      try {
        const result = await recordMarketingConversion({
          restaurantId: request.restaurantId!,
          campaignId: id,
          customerId: body.customerId,
          reservationId: body.reservationId,
          conversionType: body.conversionType,
          attributedAt: body.attributedAt,
          windowEndsAt: body.windowEndsAt,
        });
        return reply.status(result.created ? 201 : 200).send({ data: result });
      } catch (error) {
        const status = statusForError(error);
        if (status === 404) {
          const errorCode =
            error instanceof Error && error.message === 'CUSTOMER_NOT_FOUND'
              ? 'CUSTOMER_NOT_FOUND'
              : 'CAMPAIGN_NOT_FOUND';
          return reply.status(status).send({ error: errorCode });
        }
        throw error;
      }
    },
  );

  app.post(
    '/marketing/campaigns/:id/conversions/deactivate',
    { preHandler: requireMarketingAttribution },
    async (request, reply) => {
      const { id } = CampaignIdParamsSchema.parse(request.params);
      const body = DeactivateConversionBodySchema.parse(request.body);
      const campaign = await getMarketingCampaign({
        restaurantId: request.restaurantId!,
        campaignId: id,
      });
      if (!campaign) return reply.status(404).send({ error: 'CAMPAIGN_NOT_FOUND' });
      const count = await deactivateMarketingConversions({
        restaurantId: request.restaurantId!,
        reservationId: body.reservationId,
      });
      return reply.send({ data: { deactivated: count } });
    },
  );
}
