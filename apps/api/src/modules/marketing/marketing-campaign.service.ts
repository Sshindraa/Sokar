import { createHash } from 'node:crypto';
import {
  MarketingCampaignStatus,
  MarketingChannel,
  MarketingMessageStatus,
  Prisma,
  type MarketingCampaign,
} from '@prisma/client';
import { db } from '../../shared/db/client';
import {
  compileCustomerSegmentWhere,
  parseCustomerSegmentDefinition,
} from '../customers/customer-segment.service';
import {
  loadLegacyMarketingOptIns,
  resolveMarketingPermission,
  type MarketingChannelCode,
} from './marketing-permission.service';
import { countSmsSegments, countSmsUnits } from '../usage/messaging-usage.service';
import { resolveUsageTariff } from '../usage/usage-tariff.service';

export const CAMPAIGN_CHANNELS = ['SMS', 'EMAIL', 'WHATSAPP'] as const;
export const MAX_CAMPAIGN_AUDIENCE = 10_000;
export const MAX_SENDS_PER_FREQUENCY_WINDOW = 3;

const ALLOWED_TEMPLATE_VARIABLES = new Set([
  'customer.firstName',
  'customer.name',
  'restaurant.name',
  'reservationLink',
  'unsubscribeUrl',
]);

type CampaignChannelCode = (typeof CAMPAIGN_CHANNELS)[number];

export type CampaignAudienceMemberDraft = {
  customerId: string;
  inclusionReason: string;
  snapshot: Record<string, unknown>;
};

export type CampaignAudiencePreview = {
  channel: CampaignChannelCode;
  audienceVersion: number;
  candidateCount: number;
  eligibleCount: number;
  excludedByReason: Record<string, number>;
  sample: Array<{ id: string; name: string | null; isVip: boolean; inclusionReason: string }>;
  members: CampaignAudienceMemberDraft[];
};

export type MarketingTemplateContext = {
  customer: { firstName: string; name: string };
  restaurant: { name: string; slug?: string | null };
  reservationLink: string;
  unsubscribeUrl: string;
};

export type MarketingCampaignPreview = {
  campaign: {
    id: string;
    name: string;
    objective: string;
    channel: CampaignChannelCode;
    status: string;
    subject: string | null;
    bodyTemplate: string;
    scheduledAt: Date | null;
    timezone: string;
  };
  audience: {
    captured: number;
    eligible: number;
    sampleCustomer: string | null;
  };
  render: {
    subject: string | null;
    body: string;
    usedFallbackCustomer: boolean;
  };
  usage: {
    category: 'SMS_SEGMENTS' | 'WHATSAPP_MESSAGES' | 'EMAIL_MESSAGES';
    unitsPerMessage: number;
    totalUnits: number;
    encoding: 'gsm7' | 'ucs2' | 'message';
  };
  costEstimate: {
    amount: string | null;
    currency: 'EUR';
    status: 'PRICED' | 'NOT_AVAILABLE';
    reason: 'PROVIDER_TARIFF_RECONCILED' | 'PROVIDER_TARIFF_NOT_RECONCILED';
    tariffId?: string;
    pricePerUnit?: string;
  };
};

export type MarketingCampaignTestPreview = {
  mode: 'DRY_RUN';
  providerContacted: false;
  recipient: 'MANAGER';
  reason: 'PROVIDER_TEST_NOT_WIRED';
  preview: MarketingCampaignPreview;
};

function normalizeChannel(value: CampaignChannelCode): MarketingChannel {
  if (!CAMPAIGN_CHANNELS.includes(value)) throw new Error('unsupported marketing channel');
  return value as MarketingChannel;
}

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

export function validateMarketingTemplate(args: {
  channel: CampaignChannelCode;
  subject?: string | null;
  bodyTemplate: string;
}): { subject: string | null; bodyTemplate: string } {
  const bodyTemplate = normalizeText(
    args.bodyTemplate,
    'bodyTemplate',
    args.channel === 'EMAIL' ? 10_000 : 918,
  );
  const variables = [...bodyTemplate.matchAll(/{{\s*([a-zA-Z][a-zA-Z0-9.]*)\s*}}/g)].map(
    (match) => match[1],
  );
  for (const variable of variables) {
    if (!ALLOWED_TEMPLATE_VARIABLES.has(variable)) {
      throw new Error(`template variable is not allow-listed: ${variable}`);
    }
  }
  if (!bodyTemplate.includes('{{unsubscribeUrl}}')) {
    throw new Error('marketing template must include {{unsubscribeUrl}}');
  }

  const subject = args.subject?.trim() || null;
  if (args.channel === 'EMAIL') {
    if (!subject) throw new Error('email campaign requires a subject');
    if (subject.length > 200) throw new Error('subject must contain at most 200 characters');
  } else if (subject) {
    throw new Error('subject is only supported for email campaigns');
  }
  return { subject, bodyTemplate };
}

/**
 * Renders only variables accepted by validateTemplate. Keeping this helper
 * deterministic makes previews and provider jobs produce the same bytes.
 */
export function renderMarketingTemplate(
  template: string,
  context: MarketingTemplateContext,
): string {
  const values: Record<string, string> = {
    'customer.firstName': context.customer.firstName,
    'customer.name': context.customer.name,
    'restaurant.name': context.restaurant.name,
    reservationLink: context.reservationLink,
    unsubscribeUrl: context.unsubscribeUrl,
  };
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9.]*)\s*}}/g, (_match, key: string) => {
    const value = values[key];
    if (value === undefined) throw new Error(`template variable has no value: ${key}`);
    return value;
  });
}

export function toMarketingHtml(text: string): string {
  const escaped = text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
  return escaped.replaceAll(/\r?\n/g, '<br>');
}

export async function ensureCampaignMessages(
  campaignId: string,
  channel: CampaignChannelCode,
  writer: Pick<Prisma.TransactionClient, 'campaignAudienceMember' | 'campaignMessage'> = db,
): Promise<void> {
  const audience =
    (await writer.campaignAudienceMember.findMany({
      where: { campaignId },
      select: { id: true, customerId: true },
      orderBy: { id: 'asc' },
    })) ?? [];
  if (audience.length === 0) return;
  await writer.campaignMessage.createMany({
    data: audience.map((member) => ({
      campaignId,
      audienceMemberId: member.id,
      customerId: member.customerId,
      channel: normalizeChannel(channel),
      status: MarketingMessageStatus.PENDING,
      idempotencyKey: `marketing:${campaignId}:${member.customerId}`,
    })),
    skipDuplicates: true,
  });
}

async function resolveSegmentDefinition(args: {
  restaurantId: string;
  segmentId?: string;
  definition?: unknown;
}): Promise<{
  segmentId: string | null;
  definition: ReturnType<typeof parseCustomerSegmentDefinition>;
}> {
  if (args.segmentId && args.definition !== undefined) {
    throw new Error('provide segmentId or definition, not both');
  }
  if (args.segmentId) {
    const segment = await db.customerSegment.findFirst({
      where: { id: args.segmentId, restaurantId: args.restaurantId },
      select: { id: true, definition: true },
    });
    if (!segment) throw new Error('SEGMENT_NOT_FOUND');
    return {
      segmentId: segment.id,
      definition: parseCustomerSegmentDefinition(segment.definition),
    };
  }
  if (args.definition === undefined) throw new Error('segmentId or definition is required');
  return { segmentId: null, definition: parseCustomerSegmentDefinition(args.definition) };
}

function incrementReason(target: Record<string, number>, reason: string): void {
  target[reason] = (target[reason] ?? 0) + 1;
}

async function buildAudience(args: {
  restaurantId: string;
  channel: CampaignChannelCode;
  segmentId?: string;
  definition?: unknown;
  now?: Date;
  sampleLimit?: number;
}): Promise<CampaignAudiencePreview> {
  const now = args.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('now must be a valid date');
  const channel = normalizeChannel(args.channel);
  const resolved = await resolveSegmentDefinition(args);
  const where: Prisma.CustomerWhereInput = {
    restaurantId: args.restaurantId,
    archivedAt: null,
    mergedIntoId: null,
    ...compileCustomerSegmentWhere(resolved.definition, now),
  };

  const candidates = ((await db.customer.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: MAX_CAMPAIGN_AUDIENCE + 1,
    select: { id: true, name: true, isVip: true, phone: true, emailNormalized: true },
  })) ?? []) as Array<{
    id: string;
    name: string | null;
    isVip: boolean;
    phone: string;
    emailNormalized: string | null;
  }>;

  if (candidates.length > MAX_CAMPAIGN_AUDIENCE) {
    throw new Error(`AUDIENCE_TOO_LARGE:${MAX_CAMPAIGN_AUDIENCE}`);
  }
  if (candidates.length === 0) {
    return {
      channel: args.channel,
      audienceVersion: 1,
      candidateCount: 0,
      eligibleCount: 0,
      excludedByReason: {},
      sample: [],
      members: [],
    };
  }

  const customerIds = candidates.map((customer) => customer.id);
  const [permissions, suppressions, frequencyWindows, legacyOptIns] = await Promise.all([
    db.marketingPermission.findMany({
      where: { restaurantId: args.restaurantId, customerId: { in: customerIds }, channel },
      select: { customerId: true, status: true, source: true },
    }),
    db.marketingSuppression.findMany({
      where: {
        restaurantId: args.restaurantId,
        customerId: { in: customerIds },
        OR: [{ channel: null }, { channel }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
      },
      select: { customerId: true, channel: true, reason: true },
    }),
    db.marketingFrequencyWindow.findMany({
      where: {
        restaurantId: args.restaurantId,
        customerId: { in: customerIds },
        channel,
        windowStart: { lte: now },
        windowEnd: { gt: now },
      },
      select: { customerId: true, sendCount: true },
    }),
    loadLegacyMarketingOptIns({ restaurantId: args.restaurantId, customers: candidates }),
  ]);

  const permissionByCustomer = new Map(
    (permissions ?? []).map((permission) => [permission.customerId, permission]),
  );
  const suppressionByCustomer = new Map<string, string>();
  for (const suppression of suppressions ?? []) {
    suppressionByCustomer.set(suppression.customerId, suppression.reason);
  }
  const frequencyByCustomer = new Set(
    (frequencyWindows ?? [])
      .filter((window) => window.sendCount >= MAX_SENDS_PER_FREQUENCY_WINDOW)
      .map((window) => window.customerId),
  );

  const excludedByReason: Record<string, number> = {};
  const members: CampaignAudienceMemberDraft[] = [];
  for (const customer of candidates) {
    const hasContact =
      args.channel === 'EMAIL' ? Boolean(customer.emailNormalized) : Boolean(customer.phone);
    if (!hasContact) {
      incrementReason(excludedByReason, 'NO_CONTACT');
      continue;
    }
    const suppressionReason = suppressionByCustomer.get(customer.id);
    if (suppressionReason) {
      incrementReason(excludedByReason, `SUPPRESSED:${suppressionReason}`);
      continue;
    }
    if (frequencyByCustomer.has(customer.id)) {
      incrementReason(excludedByReason, 'FREQUENCY_CAP');
      continue;
    }
    const permission = resolveMarketingPermission({
      channel: args.channel as MarketingChannelCode,
      channelStatus: permissionByCustomer.get(customer.id)?.status,
      legacyMarketingOptIn: legacyOptIns.has(customer.id),
    });
    if (!permission.allowed) {
      incrementReason(
        excludedByReason,
        permission.reason === 'OPTED_OUT' ? 'OPTED_OUT' : 'NO_CONSENT',
      );
      continue;
    }
    members.push({
      customerId: customer.id,
      inclusionReason:
        permission.source === 'LEGACY_CUSTOMER_CONSENT' ? 'LEGACY_CONSENT' : 'CHANNEL_OPT_IN',
      snapshot: {
        permissionSource: permission.source,
        permissionStatus: permission.status,
        capturedAt: now.toISOString(),
      },
    });
  }

  const sampleLimit = Math.min(Math.max(args.sampleLimit ?? 10, 1), 20);
  const eligibleIds = new Set(members.map((member) => member.customerId));
  return {
    channel: args.channel,
    audienceVersion: 1,
    candidateCount: candidates.length,
    eligibleCount: members.length,
    excludedByReason,
    sample: candidates
      .filter((customer) => eligibleIds.has(customer.id))
      .slice(0, sampleLimit)
      .map((customer) => ({
        id: customer.id,
        name: customer.name,
        isVip: customer.isVip,
        inclusionReason:
          permissionByCustomer.get(customer.id)?.status === 'OPTED_IN'
            ? 'CHANNEL_OPT_IN'
            : 'LEGACY_CONSENT',
      })),
    members,
  };
}

export async function previewMarketingAudience(args: {
  restaurantId: string;
  channel: CampaignChannelCode;
  segmentId?: string;
  definition?: unknown;
  now?: Date;
  sampleLimit?: number;
}): Promise<Omit<CampaignAudiencePreview, 'members'>> {
  const result = await buildAudience(args);
  const { members: _members, ...preview } = result;
  return preview;
}

export async function createMarketingCampaign(args: {
  restaurantId: string;
  name: string;
  objective: string;
  channel: CampaignChannelCode;
  segmentId: string;
  subject?: string | null;
  bodyTemplate: string;
  scheduledAt?: Date | null;
  timezone?: string;
  createdBy?: string;
}): Promise<MarketingCampaign> {
  const name = normalizeText(args.name, 'name', 100);
  const objective = normalizeText(args.objective, 'objective', 120);
  const timezone = normalizeText(args.timezone ?? 'Europe/Paris', 'timezone', 80);
  const scheduledAt = args.scheduledAt ?? null;
  if (scheduledAt && Number.isNaN(scheduledAt.getTime()))
    throw new Error('scheduledAt must be valid');
  const content = validateMarketingTemplate(args);
  const audience = await buildAudience({
    restaurantId: args.restaurantId,
    channel: args.channel,
    segmentId: args.segmentId,
  });
  const now = new Date();
  return db.$transaction(async (tx) => {
    const campaign = await tx.marketingCampaign.create({
      data: {
        restaurantId: args.restaurantId,
        name,
        objective,
        channel: normalizeChannel(args.channel),
        segmentId: args.segmentId,
        status: MarketingCampaignStatus.DRAFT,
        subject: content.subject,
        bodyTemplate: content.bodyTemplate,
        scheduledAt,
        timezone,
        audienceVersion: audience.audienceVersion,
        audienceCount: audience.eligibleCount,
        createdByHash: args.createdBy ? hashActor(args.createdBy) : hashActor(undefined),
      },
    });
    if (audience.members.length > 0) {
      await tx.campaignAudienceMember.createMany({
        data: audience.members.map((member) => ({
          campaignId: campaign.id,
          customerId: member.customerId,
          audienceVersion: audience.audienceVersion,
          inclusionReason: member.inclusionReason,
          snapshot: member.snapshot as Prisma.InputJsonValue,
          capturedAt: now,
        })),
      });
    }
    return campaign;
  });
}

function hashActor(actor: string | undefined): string {
  // The actor hash is deliberately derived without storing a user id in the
  // campaign row. The API can still correlate the audit event separately.
  return createActorHash(actor);
}

function createActorHash(actor: string | undefined): string {
  // Avoid importing a second crypto helper into route code; this is SHA-256
  // over a normalized opaque actor value.
  return createHash('sha256')
    .update(actor?.trim() || 'unknown')
    .digest('hex');
}

export async function listMarketingCampaigns(args: {
  restaurantId: string;
  limit?: number;
}): Promise<MarketingCampaign[]> {
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
  return db.marketingCampaign.findMany({
    where: { restaurantId: args.restaurantId },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });
}

export async function getMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
}): Promise<MarketingCampaign | null> {
  return db.marketingCampaign.findFirst({
    where: { id: args.campaignId, restaurantId: args.restaurantId },
  });
}

function previewContext(
  customerName: string | null | undefined,
  restaurantName: string,
): {
  context: MarketingTemplateContext;
  usedFallbackCustomer: boolean;
} {
  const normalizedName = customerName?.trim() || '';
  const firstName = normalizedName.split(/\s+/)[0] || 'Client';
  return {
    context: {
      customer: {
        firstName,
        name: normalizedName || 'Client de démonstration',
      },
      restaurant: { name: restaurantName || 'Votre restaurant' },
      reservationLink: 'https://sokar.tech/book/preview?campaignPreview=1',
      unsubscribeUrl: 'https://sokar.tech/marketing/unsubscribe?token=preview',
    },
    usedFallbackCustomer: !normalizedName,
  };
}

/**
 * Render a campaign without creating messages or contacting a provider.
 * Audience membership is read from the immutable campaign snapshot so a
 * preview cannot silently drift when the underlying segment changes.
 */
export async function previewMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
}): Promise<MarketingCampaignPreview> {
  const campaign = await db.marketingCampaign.findFirst({
    where: { id: args.campaignId, restaurantId: args.restaurantId },
    select: {
      id: true,
      name: true,
      objective: true,
      channel: true,
      status: true,
      subject: true,
      bodyTemplate: true,
      scheduledAt: true,
      timezone: true,
      audienceCount: true,
      restaurant: { select: { name: true } },
    },
  });
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');

  const content = validateMarketingTemplate({
    channel: campaign.channel as CampaignChannelCode,
    subject: campaign.subject,
    bodyTemplate: campaign.bodyTemplate,
  });
  const snapshot = await db.campaignAudienceMember.findMany({
    where: { campaignId: campaign.id },
    orderBy: { customerId: 'asc' },
    take: 1,
    select: { customerId: true },
  });
  const sampleCustomerId = snapshot[0]?.customerId ?? null;
  const sampleCustomer = sampleCustomerId
    ? await db.customer.findFirst({
        where: { id: sampleCustomerId, restaurantId: args.restaurantId, archivedAt: null },
        select: { name: true },
      })
    : null;
  const rendered = previewContext(sampleCustomer?.name, campaign.restaurant.name);
  const body = renderMarketingTemplate(content.bodyTemplate, rendered.context);
  const isSms = campaign.channel === 'SMS';
  const smsUnits = isSms ? countSmsUnits(body) : null;
  const unitsPerMessage = isSms ? countSmsSegments(body) : 1;
  const encoding = isSms ? smsUnits!.encoding : 'message';
  const costDimension =
    campaign.channel === 'SMS'
      ? { category: 'SMS_SEGMENTS' as const, provider: 'telnyx', unit: 'segments' }
      : campaign.channel === 'EMAIL'
        ? { category: 'EMAIL_MESSAGES' as const, provider: 'resend', unit: 'messages' }
        : { category: 'WHATSAPP_MESSAGES' as const, provider: 'telnyx', unit: 'messages' };
  const tariff = await resolveUsageTariff({
    ...costDimension,
    quantity: unitsPerMessage * campaign.audienceCount,
    // A scheduled campaign is priced against its execution window. An
    // unscheduled draft uses the preview instant and is recalculated on send.
    occurredAt: campaign.scheduledAt ?? new Date(),
  });
  const costEstimate =
    tariff.costStatus === 'PRICED'
      ? {
          amount: tariff.estimatedCostEur,
          currency: 'EUR' as const,
          status: 'PRICED' as const,
          reason: 'PROVIDER_TARIFF_RECONCILED' as const,
          ...(tariff.tariffId ? { tariffId: tariff.tariffId } : {}),
          ...(tariff.pricePerUnit ? { pricePerUnit: tariff.pricePerUnit } : {}),
        }
      : {
          amount: null,
          currency: 'EUR' as const,
          status: 'NOT_AVAILABLE' as const,
          reason: 'PROVIDER_TARIFF_NOT_RECONCILED' as const,
        };

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      objective: campaign.objective,
      channel: campaign.channel as CampaignChannelCode,
      status: campaign.status,
      subject: content.subject,
      bodyTemplate: content.bodyTemplate,
      scheduledAt: campaign.scheduledAt,
      timezone: campaign.timezone,
    },
    audience: {
      captured: campaign.audienceCount,
      eligible: campaign.audienceCount,
      sampleCustomer: sampleCustomer?.name ?? null,
    },
    render: {
      subject: content.subject,
      body,
      usedFallbackCustomer: rendered.usedFallbackCustomer,
    },
    usage: {
      category:
        campaign.channel === 'SMS'
          ? 'SMS_SEGMENTS'
          : campaign.channel === 'EMAIL'
            ? 'EMAIL_MESSAGES'
            : 'WHATSAPP_MESSAGES',
      unitsPerMessage,
      totalUnits: unitsPerMessage * campaign.audienceCount,
      encoding,
    },
    costEstimate,
  };
}

/**
 * Produce the manager test payload without contacting a provider. Keeping this
 * endpoint explicit prevents a dashboard test click from bypassing the global
 * send flag or consuming a customer frequency slot.
 */
export async function testMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
}): Promise<MarketingCampaignTestPreview> {
  return {
    mode: 'DRY_RUN',
    providerContacted: false,
    recipient: 'MANAGER',
    reason: 'PROVIDER_TEST_NOT_WIRED',
    preview: await previewMarketingCampaign(args),
  };
}

export type MarketingCampaignUpdateInput = {
  name?: string;
  objective?: string;
  channel?: CampaignChannelCode;
  segmentId?: string;
  subject?: string | null;
  bodyTemplate?: string;
  scheduledAt?: Date | null;
  timezone?: string;
};

/**
 * Update a draft campaign while preserving the audience snapshot contract.
 * READY campaigns may change copy and scheduling metadata, but changing their
 * channel or segment would invalidate already-created message rows and is
 * rejected explicitly.
 */
export async function updateMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
  changes: MarketingCampaignUpdateInput;
}): Promise<MarketingCampaign> {
  const campaign = await getMarketingCampaign(args);
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  if (
    campaign.status !== MarketingCampaignStatus.DRAFT &&
    campaign.status !== MarketingCampaignStatus.READY
  ) {
    throw new Error('CAMPAIGN_NOT_EDITABLE');
  }

  const nextChannel = args.changes.channel ?? (campaign.channel as CampaignChannelCode);
  const channelChanged = nextChannel !== campaign.channel;
  const segmentChanged =
    args.changes.segmentId !== undefined && args.changes.segmentId !== campaign.segmentId;
  if (campaign.status !== MarketingCampaignStatus.DRAFT && (channelChanged || segmentChanged)) {
    throw new Error('CAMPAIGN_AUDIENCE_FROZEN');
  }
  const nextBody = args.changes.bodyTemplate ?? campaign.bodyTemplate;
  const nextSubject = args.changes.subject === undefined ? campaign.subject : args.changes.subject;
  const content = validateMarketingTemplate({
    channel: nextChannel,
    subject: nextSubject,
    bodyTemplate: nextBody,
  });
  const nextName =
    args.changes.name === undefined ? campaign.name : normalizeText(args.changes.name, 'name', 100);
  const nextObjective =
    args.changes.objective === undefined
      ? campaign.objective
      : normalizeText(args.changes.objective, 'objective', 120);
  const nextTimezone =
    args.changes.timezone === undefined
      ? campaign.timezone
      : normalizeText(args.changes.timezone, 'timezone', 80);
  const nextScheduledAt =
    args.changes.scheduledAt === undefined ? campaign.scheduledAt : args.changes.scheduledAt;
  if (nextScheduledAt && Number.isNaN(nextScheduledAt.getTime())) {
    throw new Error('scheduledAt must be valid');
  }

  let audience: CampaignAudiencePreview | null = null;
  if (segmentChanged) {
    audience = await buildAudience({
      restaurantId: args.restaurantId,
      channel: nextChannel,
      segmentId: args.changes.segmentId,
    });
  }

  const now = new Date();
  return db.$transaction(async (tx) => {
    if (audience) {
      await tx.campaignAudienceMember.deleteMany({ where: { campaignId: campaign.id } });
      if (audience.members.length > 0) {
        await tx.campaignAudienceMember.createMany({
          data: audience.members.map((member) => ({
            campaignId: campaign.id,
            customerId: member.customerId,
            audienceVersion: campaign.audienceVersion + 1,
            inclusionReason: member.inclusionReason,
            snapshot: member.snapshot as Prisma.InputJsonValue,
            capturedAt: now,
          })),
        });
      }
    }
    return tx.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        name: nextName,
        objective: nextObjective,
        channel: normalizeChannel(nextChannel),
        subject: content.subject,
        bodyTemplate: content.bodyTemplate,
        scheduledAt: nextScheduledAt,
        timezone: nextTimezone,
        ...(segmentChanged
          ? {
              segmentId: args.changes.segmentId,
              audienceVersion: campaign.audienceVersion + 1,
              audienceCount: audience?.eligibleCount ?? 0,
            }
          : {}),
        lastErrorCode: null,
      },
    });
  });
}

export async function prepareMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
}): Promise<MarketingCampaign> {
  const campaign = await getMarketingCampaign(args);
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  if (campaign.status !== MarketingCampaignStatus.DRAFT) {
    throw new Error('CAMPAIGN_NOT_DRAFT');
  }
  if (campaign.audienceCount < 1) throw new Error('AUDIENCE_EMPTY');
  return db.$transaction(async (tx) => {
    await ensureCampaignMessages(campaign.id, campaign.channel, tx);
    return tx.marketingCampaign.update({
      where: { id: campaign.id },
      data: { status: MarketingCampaignStatus.READY, lastErrorCode: null },
    });
  });
}

export async function scheduleMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
  scheduledAt: Date;
}): Promise<MarketingCampaign> {
  const scheduledAt = args.scheduledAt;
  if (Number.isNaN(scheduledAt.getTime())) throw new Error('scheduledAt must be valid');
  if (scheduledAt.getTime() <= Date.now()) throw new Error('scheduledAt must be in the future');
  const campaign = await getMarketingCampaign(args);
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  if (campaign.status !== MarketingCampaignStatus.READY) {
    throw new Error('CAMPAIGN_NOT_READY');
  }
  return db.marketingCampaign.update({
    where: { id: campaign.id },
    data: { status: MarketingCampaignStatus.SCHEDULED, scheduledAt, lastErrorCode: null },
  });
}

/** Atomically claims a READY/SCHEDULED campaign for a worker. */
export async function startMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
  now?: Date;
}): Promise<MarketingCampaign> {
  const now = args.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('now must be valid');
  const campaign = await getMarketingCampaign(args);
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  if (
    campaign.status !== MarketingCampaignStatus.READY &&
    campaign.status !== MarketingCampaignStatus.SCHEDULED
  ) {
    if (campaign.status === MarketingCampaignStatus.SENDING) {
      throw new Error('CAMPAIGN_ALREADY_RUNNING');
    }
    throw new Error('CAMPAIGN_NOT_READY');
  }
  if (campaign.status === MarketingCampaignStatus.SCHEDULED && campaign.scheduledAt) {
    if (campaign.scheduledAt.getTime() > now.getTime()) {
      throw new Error('CAMPAIGN_NOT_DUE');
    }
  }
  const claimed = await db.marketingCampaign.updateMany({
    where: {
      id: campaign.id,
      restaurantId: args.restaurantId,
      status: { in: [MarketingCampaignStatus.READY, MarketingCampaignStatus.SCHEDULED] },
    },
    data: {
      status: MarketingCampaignStatus.SENDING,
      startedAt: now,
      completedAt: null,
      lastErrorCode: null,
    },
  });
  if (claimed.count !== 1) throw new Error('CAMPAIGN_ALREADY_RUNNING');
  const updated = await getMarketingCampaign(args);
  if (!updated) throw new Error('CAMPAIGN_NOT_FOUND');
  return updated;
}

export async function cancelMarketingCampaign(args: {
  restaurantId: string;
  campaignId: string;
}): Promise<MarketingCampaign> {
  const campaign = await getMarketingCampaign(args);
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  if (
    campaign.status === MarketingCampaignStatus.SENT ||
    campaign.status === MarketingCampaignStatus.CANCELLED
  ) {
    throw new Error('CAMPAIGN_NOT_CANCELLABLE');
  }
  return db.marketingCampaign.update({
    where: { id: campaign.id },
    data: { status: MarketingCampaignStatus.CANCELLED, completedAt: new Date() },
  });
}
