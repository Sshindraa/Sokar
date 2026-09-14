import { createHash } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import { MarketingCampaignStatus, MarketingMessageStatus, type PrismaClient } from '@prisma/client';
import { db } from '../../shared/db/client';
import { sendEmail } from '../../shared/email';
import { sendSms } from '../../shared/telnyx/client';
import { sendWhatsApp } from '../../shared/telnyx/client';
import {
  normalizeNotificationSendResult,
  type NotificationSendResult,
} from '../../shared/queue/notification-idempotency';
import { redisQueue } from '../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../shared/queue/workers/helper';
import type { MessagingUsageContext } from '../usage/messaging-usage.service';
import {
  ensureCampaignMessages,
  MAX_SENDS_PER_FREQUENCY_WINDOW,
  renderMarketingTemplate,
  toMarketingHtml,
} from './marketing-campaign.service';
import {
  resolveMarketingPermission,
  type MarketingChannelCode,
} from './marketing-permission.service';
import {
  buildMarketingUnsubscribeUrl,
  createMarketingUnsubscribeToken,
} from './marketing-unsubscribe.service';
import { createMarketingAttributionLink } from './marketing-attribution.service';

export type MarketingCampaignJobData = {
  campaignId: string;
  restaurantId: string;
};

type CampaignWorkerDb = Pick<
  PrismaClient,
  | 'marketingCampaign'
  | 'campaignMessage'
  | 'marketingPermission'
  | 'marketingSuppression'
  | 'marketingFrequencyWindow'
  | 'customerConsent'
  | 'customer'
> & {
  campaignAudienceMember: PrismaClient['campaignAudienceMember'];
};

export type MarketingCampaignWorkerDependencies = {
  db: CampaignWorkerDb;
  sendSms: typeof sendSms;
  sendEmail: typeof sendEmail;
  sendWhatsApp: typeof sendWhatsApp;
  createUnsubscribeToken: typeof createMarketingUnsubscribeToken;
  /** Injected in tests; production persists a signed campaign link per recipient. */
  createAttributionLink?: typeof createMarketingAttributionLink;
  sendsEnabled: boolean;
  now: () => Date;
};

/** A provider attempt older than this is no longer safe to leave in-flight. */
export const MARKETING_MESSAGE_STALE_AFTER_MS = 15 * 60 * 1000;

function defaultDependencies(): MarketingCampaignWorkerDependencies {
  return {
    db,
    sendSms,
    sendEmail,
    sendWhatsApp,
    createUnsubscribeToken: createMarketingUnsubscribeToken,
    createAttributionLink: createMarketingAttributionLink,
    sendsEnabled: process.env.MARKETING_SENDS_ENABLED === 'true',
    now: () => new Date(),
  };
}

function validNow(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new Error('now must be valid');
  return now;
}

function dayWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/**
 * Atomically consumes one send slot. The conditional update wins when a row
 * already exists; the unique constraint handles the first-writer race.
 */
export async function reserveMarketingFrequencySlot(
  input: {
    restaurantId: string;
    customerId: string;
    channel: MarketingChannelCode;
    now: Date;
  },
  writer: Pick<PrismaClient, 'marketingFrequencyWindow'>,
): Promise<boolean> {
  const { start, end } = dayWindow(input.now);
  const where = {
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    channel: input.channel,
    windowStart: start,
  };
  const updated = await writer.marketingFrequencyWindow.updateMany({
    where: { ...where, sendCount: { lt: MAX_SENDS_PER_FREQUENCY_WINDOW } },
    data: { sendCount: { increment: 1 }, windowEnd: end },
  });
  if (updated.count === 1) return true;
  try {
    await writer.marketingFrequencyWindow.create({
      data: { ...where, windowEnd: end, sendCount: 1 },
    });
    return true;
  } catch (error) {
    // Prisma's P2002 is the expected race when another worker inserted the
    // same first-day row. A conditional retry preserves the cap.
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      (error as { code?: string }).code !== 'P2002'
    ) {
      throw error;
    }
    const raced = await writer.marketingFrequencyWindow.updateMany({
      where: { ...where, sendCount: { lt: MAX_SENDS_PER_FREQUENCY_WINDOW } },
      data: { sendCount: { increment: 1 }, windowEnd: end },
    });
    return raced.count === 1;
  }
}

function hashPhone(phone: string): string {
  return createHash('sha256').update(phone.trim().toLowerCase()).digest('hex');
}

async function legacyOptedIn(
  deps: MarketingCampaignWorkerDependencies,
  restaurantId: string,
  phone: string,
): Promise<boolean> {
  const row = await deps.db.customerConsent.findFirst({
    where: { restaurantId, subjectHash: hashPhone(phone), marketingOptIn: true },
    select: { subjectHash: true },
  });
  return Boolean(row);
}

function safeErrorCode(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const normalized = raw
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]+/g, '_')
    .slice(0, 80);
  return normalized || 'PROVIDER_ERROR';
}

async function markMessage(
  deps: MarketingCampaignWorkerDependencies,
  messageId: string,
  status: MarketingMessageStatus,
  data: Record<string, unknown> = {},
): Promise<boolean> {
  const updated = await deps.db.campaignMessage.updateMany({
    where: { id: messageId, status: MarketingMessageStatus.SENDING },
    data: { status, ...data },
  });
  return updated.count === 1;
}

async function markCampaignCounter(
  deps: MarketingCampaignWorkerDependencies,
  campaignId: string,
  field: 'acceptedCount' | 'failedCount',
): Promise<void> {
  await deps.db.marketingCampaign.update({
    where: { id: campaignId },
    data: { [field]: { increment: 1 } },
  });
}

/**
 * A process can die after claiming a row and before persisting the provider
 * result. We do not automatically resend such a row: the provider may have
 * accepted it already. Marking it failed with an explicit review code keeps
 * the campaign resumable by an operator without creating a blind duplicate.
 */
async function failStaleMessageClaims(
  deps: MarketingCampaignWorkerDependencies,
  campaignId: string,
  now: Date,
): Promise<number> {
  const staleBefore = new Date(now.getTime() - MARKETING_MESSAGE_STALE_AFTER_MS);
  const result = await deps.db.campaignMessage.updateMany({
    where: {
      campaignId,
      status: MarketingMessageStatus.SENDING,
      updatedAt: { lt: staleBefore },
    },
    data: {
      status: MarketingMessageStatus.FAILED,
      errorCode: 'STALE_CLAIM_MANUAL_REVIEW',
    },
  });
  if (result.count > 0) {
    await deps.db.marketingCampaign.update({
      where: { id: campaignId },
      data: {
        failedCount: { increment: result.count },
        lastErrorCode: 'STALE_CLAIM_MANUAL_REVIEW',
      },
    });
  }
  return result.count;
}

export function buildMarketingReservationLink(
  slug: string | null | undefined,
  attributionToken?: string,
): string {
  // `/book/:slug` is the canonical public booking URL. The dashboard
  // middleware rewrites it to the reservation widget while preserving query
  // parameters, so the signed token reaches the API creation route.
  const base =
    process.env.DASHBOARD_URL?.trim() ||
    process.env.SITE_URL?.trim() ||
    process.env.PUBLIC_URL?.trim() ||
    'https://sokar.tech';
  const path = slug ? `/book/${encodeURIComponent(slug)}` : '/';
  try {
    const url = new URL(path, base);
    if (attributionToken) url.searchParams.set('marketingAttributionToken', attributionToken);
    return url.toString();
  } catch {
    const suffix = attributionToken
      ? `?marketingAttributionToken=${encodeURIComponent(attributionToken)}`
      : '';
    return `${base.replace(/\/$/, '')}${path}${suffix}`;
  }
}

async function eligibility(
  deps: MarketingCampaignWorkerDependencies,
  args: {
    restaurantId: string;
    customer: { id: string; phone: string; emailNormalized: string | null };
    channel: MarketingChannelCode;
    now: Date;
  },
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const [permission, suppression, activeCustomer] = await Promise.all([
    deps.db.marketingPermission.findUnique({
      where: { customerId_channel: { customerId: args.customer.id, channel: args.channel } },
      select: { status: true },
    }),
    deps.db.marketingSuppression.findFirst({
      where: {
        restaurantId: args.restaurantId,
        customerId: args.customer.id,
        OR: [{ channel: null }, { channel: args.channel }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: args.now } }] }],
      },
      select: { reason: true },
    }),
    deps.db.customer.findFirst({
      where: {
        id: args.customer.id,
        restaurantId: args.restaurantId,
        archivedAt: null,
        mergedIntoId: null,
      },
      select: { id: true },
    }),
  ]);
  if (!activeCustomer) return { allowed: false, reason: 'CUSTOMER_INACTIVE' };
  if (suppression) return { allowed: false, reason: `SUPPRESSED_${suppression.reason}` };
  const legacy =
    args.channel !== 'WHATSAPP' &&
    !permission &&
    (await legacyOptedIn(deps, args.restaurantId, args.customer.phone));
  const resolved = resolveMarketingPermission({
    channel: args.channel,
    channelStatus: permission?.status,
    legacyMarketingOptIn: legacy,
  });
  if (!resolved.allowed) return { allowed: false, reason: resolved.reason };
  if (args.channel === 'EMAIL' && !args.customer.emailNormalized) {
    return { allowed: false, reason: 'NO_CONTACT' };
  }
  if (args.channel !== 'EMAIL' && !args.customer.phone) {
    return { allowed: false, reason: 'NO_CONTACT' };
  }
  return { allowed: true };
}

async function sendOne(
  deps: MarketingCampaignWorkerDependencies,
  campaign: {
    id: string;
    restaurantId: string;
    channel: MarketingChannelCode;
    subject: string | null;
    bodyTemplate: string;
    restaurant: { name: string; slug: string | null };
  },
  message: {
    id: string;
    customerId: string;
    customer: { id: string; name: string | null; phone: string; emailNormalized: string | null };
  },
  now: Date,
): Promise<{ result: NotificationSendResult; renderedBody: string }> {
  let attributionToken: string | undefined;
  if (campaign.bodyTemplate.includes('{{reservationLink}}') && campaign.restaurant.slug) {
    const createAttributionLink = deps.createAttributionLink ?? createMarketingAttributionLink;
    const attribution = await createAttributionLink({
      restaurantId: campaign.restaurantId,
      campaignId: campaign.id,
      customerId: message.customer.id,
      issuedAt: now,
    });
    attributionToken = attribution.token;
  }
  const unsubscribeToken = await deps.createUnsubscribeToken({
    restaurantId: campaign.restaurantId,
    customerId: message.customer.id,
    channel: campaign.channel,
    issuedAt: now,
  });
  const displayName = message.customer.name?.trim() || 'client';
  const context = {
    customer: { firstName: displayName.split(/\s+/)[0] || displayName, name: displayName },
    restaurant: { name: campaign.restaurant.name, slug: campaign.restaurant.slug },
    reservationLink: buildMarketingReservationLink(campaign.restaurant.slug, attributionToken),
    unsubscribeUrl: buildMarketingUnsubscribeUrl(unsubscribeToken),
  };
  const rendered = renderMarketingTemplate(campaign.bodyTemplate, context);
  const usage: MessagingUsageContext = {
    restaurantId: campaign.restaurantId,
    sourceType: 'marketing_campaign',
    sourceId: message.id,
    metadata: { messageType: 'marketing_campaign', campaignId: campaign.id },
  };

  if (campaign.channel === 'SMS') {
    return {
      result: normalizeNotificationSendResult(
        await deps.sendSms(message.customer.phone, rendered, usage),
        'telnyx',
        'sms',
      ),
      renderedBody: rendered,
    };
  }
  if (campaign.channel === 'EMAIL') {
    if (!message.customer.emailNormalized) throw new Error('NO_CONTACT');
    return {
      result: normalizeNotificationSendResult(
        await deps.sendEmail({
          to: message.customer.emailNormalized,
          subject: campaign.subject ?? campaign.restaurant.name,
          html: toMarketingHtml(rendered),
          usage,
        }),
        'resend',
        'email',
      ),
      renderedBody: rendered,
    };
  }
  if (process.env.MARKETING_WHATSAPP_ENABLED !== 'true') {
    throw new Error('WHATSAPP_MARKETING_DISABLED');
  }
  return {
    result: normalizeNotificationSendResult(
      await deps.sendWhatsApp(message.customer.phone, rendered, usage),
      'telnyx',
      'whatsapp',
    ),
    renderedBody: rendered,
  };
}

async function claimMessage(
  deps: MarketingCampaignWorkerDependencies,
  messageId: string,
): Promise<boolean> {
  const claimed = await deps.db.campaignMessage.updateMany({
    where: { id: messageId, status: MarketingMessageStatus.PENDING },
    data: { status: MarketingMessageStatus.SENDING },
  });
  return claimed.count === 1;
}

/** Processes a campaign in bounded batches and is safe to replay. */
export async function processMarketingCampaignJob(
  job: Job<MarketingCampaignJobData>,
  dependencies: MarketingCampaignWorkerDependencies = defaultDependencies(),
): Promise<{ processed: number; accepted: number; failed: number }> {
  const log = jobLogger(job);
  if (!dependencies.sendsEnabled) throw new Error('MARKETING_SENDS_DISABLED');
  const now = validNow(dependencies.now());
  const campaign = await dependencies.db.marketingCampaign.findFirst({
    where: { id: job.data.campaignId, restaurantId: job.data.restaurantId },
    include: { restaurant: { select: { name: true, slug: true } } },
  });
  if (!campaign) return { processed: 0, accepted: 0, failed: 0 };
  if (
    campaign.status === MarketingCampaignStatus.CANCELLED ||
    campaign.status === MarketingCampaignStatus.SENT
  ) {
    return { processed: 0, accepted: 0, failed: 0 };
  }
  if (
    campaign.status !== MarketingCampaignStatus.READY &&
    campaign.status !== MarketingCampaignStatus.SCHEDULED &&
    campaign.status !== MarketingCampaignStatus.SENDING
  ) {
    throw new Error('CAMPAIGN_NOT_READY');
  }

  if (campaign.status !== MarketingCampaignStatus.SENDING) {
    const claimed = await dependencies.db.marketingCampaign.updateMany({
      where: {
        id: campaign.id,
        restaurantId: job.data.restaurantId,
        status: { in: [MarketingCampaignStatus.READY, MarketingCampaignStatus.SCHEDULED] },
      },
      data: { status: MarketingCampaignStatus.SENDING, startedAt: now, lastErrorCode: null },
    });
    if (claimed.count !== 1) return { processed: 0, accepted: 0, failed: 0 };
  }

  await ensureCampaignMessages(campaign.id, campaign.channel, dependencies.db);
  let processed = 0;
  let accepted = 0;
  let failed = await failStaleMessageClaims(dependencies, campaign.id, now);
  while (true) {
    const latest = await dependencies.db.marketingCampaign.findFirst({
      where: { id: campaign.id, restaurantId: campaign.restaurantId },
      select: { status: true },
    });
    if (
      !latest ||
      latest.status === MarketingCampaignStatus.CANCELLED ||
      latest.status === MarketingCampaignStatus.PAUSED ||
      latest.status === MarketingCampaignStatus.FAILED ||
      latest.status === MarketingCampaignStatus.SENT
    ) {
      break;
    }
    const messages = await dependencies.db.campaignMessage.findMany({
      where: { campaignId: campaign.id, status: MarketingMessageStatus.PENDING },
      orderBy: { id: 'asc' },
      take: 100,
      include: {
        customer: { select: { id: true, name: true, phone: true, emailNormalized: true } },
      },
    });
    if (messages.length === 0) break;
    for (const message of messages) {
      const current = await dependencies.db.marketingCampaign.findFirst({
        where: { id: campaign.id, restaurantId: campaign.restaurantId },
        select: { status: true },
      });
      if (!current || current.status === MarketingCampaignStatus.CANCELLED) break;
      if (!(await claimMessage(dependencies, message.id))) continue;
      processed++;
      const currentCustomer = message.customer;
      const allowed = await eligibility(dependencies, {
        restaurantId: campaign.restaurantId,
        customer: currentCustomer,
        channel: campaign.channel,
        now,
      });
      if (!allowed.allowed) {
        await markMessage(dependencies, message.id, MarketingMessageStatus.CANCELLED, {
          errorCode: allowed.reason,
        });
        continue;
      }
      const reserved = await reserveMarketingFrequencySlot(
        {
          restaurantId: campaign.restaurantId,
          customerId: currentCustomer.id,
          channel: campaign.channel,
          now,
        },
        dependencies.db,
      );
      if (!reserved) {
        await markMessage(dependencies, message.id, MarketingMessageStatus.CANCELLED, {
          errorCode: 'FREQUENCY_CAP',
        });
        continue;
      }
      // Consent can change between the first eligibility query and the
      // frequency slot reservation. Check it once more immediately before
      // making the external provider call.
      const stillAllowed = await eligibility(dependencies, {
        restaurantId: campaign.restaurantId,
        customer: currentCustomer,
        channel: campaign.channel,
        now,
      });
      if (!stillAllowed.allowed) {
        await markMessage(dependencies, message.id, MarketingMessageStatus.CANCELLED, {
          errorCode: stillAllowed.reason,
        });
        continue;
      }
      const beforeProvider = await dependencies.db.marketingCampaign.findFirst({
        where: { id: campaign.id, restaurantId: campaign.restaurantId },
        select: { status: true },
      });
      if (!beforeProvider || beforeProvider.status === MarketingCampaignStatus.CANCELLED) {
        await markMessage(dependencies, message.id, MarketingMessageStatus.CANCELLED, {
          errorCode: 'CAMPAIGN_CANCELLED',
        });
        continue;
      }
      if (
        beforeProvider.status === MarketingCampaignStatus.PAUSED ||
        beforeProvider.status === MarketingCampaignStatus.FAILED ||
        beforeProvider.status === MarketingCampaignStatus.SENT
      ) {
        await markMessage(dependencies, message.id, MarketingMessageStatus.PENDING, {
          errorCode: null,
        });
        continue;
      }
      try {
        const sent = await sendOne(dependencies, campaign, message, now);
        const result = sent.result;
        if (result.outcome !== 'success') {
          throw new Error(
            result.outcome === 'unknown' ? 'PROVIDER_RESULT_UNKNOWN' : 'PROVIDER_REFUSED',
          );
        }
        const transitioned = await markMessage(
          dependencies,
          message.id,
          MarketingMessageStatus.ACCEPTED,
          {
            provider: result.provider,
            providerMessageId: result.providerMessageId ?? null,
            renderedBody: sent.renderedBody,
            acceptedAt: now,
            sentAt: now,
          },
        );
        if (transitioned) {
          await markCampaignCounter(dependencies, campaign.id, 'acceptedCount');
          accepted++;
        }
      } catch (error) {
        const errorCode = safeErrorCode(error);
        const transitioned = await markMessage(
          dependencies,
          message.id,
          MarketingMessageStatus.FAILED,
          {
            errorCode,
          },
        );
        if (transitioned) {
          await dependencies.db.marketingCampaign.update({
            where: { id: campaign.id },
            data: { lastErrorCode: errorCode },
          });
          await markCampaignCounter(dependencies, campaign.id, 'failedCount');
          failed++;
        }
        log.warn(
          { campaignId: campaign.id, messageId: message.id, errorCode },
          'marketing message failed',
        );
      }
    }
  }

  const [pending, sending] = await Promise.all([
    dependencies.db.campaignMessage.count({
      where: { campaignId: campaign.id, status: MarketingMessageStatus.PENDING },
    }),
    dependencies.db.campaignMessage.count({
      where: { campaignId: campaign.id, status: MarketingMessageStatus.SENDING },
    }),
  ]);
  if (pending === 0 && sending === 0) {
    await dependencies.db.marketingCampaign.update({
      where: { id: campaign.id },
      data: {
        status: failed > 0 ? MarketingCampaignStatus.FAILED : MarketingCampaignStatus.SENT,
        completedAt: now,
      },
    });
  }
  return { processed, accepted, failed };
}

export const marketingCampaignWorker = new Worker(
  'marketing-campaign',
  (job) => processMarketingCampaignJob(job as Job<MarketingCampaignJobData>),
  { connection: redisQueue, concurrency: 2 },
);

setupWorkerListeners(marketingCampaignWorker);
