import { MarketingMessageStatus, MarketingConversionType, Prisma } from '@prisma/client';
import { db } from '../../shared/db/client';

export type MarketingCampaignReport = {
  campaign: {
    id: string;
    name: string;
    channel: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
  };
  audience: {
    captured: number;
    eligible: number;
    excludedBeforeSend: number;
  };
  delivery: {
    pending: number;
    accepted: number;
    sent: number;
    delivered: number;
    failed: number;
    cancelled: number;
    bounced: number;
    complained: number;
    clicked: number;
    unsubscribed: number;
  };
  attribution: {
    reservationsCreated: number;
    visitsHonored: number;
    activeConversions: number;
    estimatedRevenue: number;
    confirmedRevenue: number;
  };
  cost: {
    amount: number | null;
    currency: 'EUR';
    status: 'NOT_AVAILABLE' | 'UNPRICED' | 'PARTIAL' | 'PRICED';
  };
};

function csvCell(value: string | number | null): string {
  const raw = value === null ? '' : String(value);
  // Prefix spreadsheet formula-like values so a campaign name cannot become
  // an executable formula when an operator opens the export.
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function marketingCampaignReportToCsv(report: MarketingCampaignReport): string {
  const rows: Array<[string, string | number | null]> = [
    ['campaign_id', report.campaign.id],
    ['campaign_name', report.campaign.name],
    ['channel', report.campaign.channel],
    ['status', report.campaign.status],
    ['created_at', report.campaign.createdAt.toISOString()],
    ['completed_at', report.campaign.completedAt?.toISOString() ?? null],
    ['audience_captured', report.audience.captured],
    ['audience_eligible', report.audience.eligible],
    ['audience_excluded_before_send', report.audience.excludedBeforeSend],
    ['delivery_pending', report.delivery.pending],
    ['delivery_accepted', report.delivery.accepted],
    ['delivery_sent', report.delivery.sent],
    ['delivery_delivered', report.delivery.delivered],
    ['delivery_failed', report.delivery.failed],
    ['delivery_cancelled', report.delivery.cancelled],
    ['delivery_bounced', report.delivery.bounced],
    ['delivery_complained', report.delivery.complained],
    ['delivery_clicked', report.delivery.clicked],
    ['unsubscribed', report.delivery.unsubscribed],
    ['reservations_created', report.attribution.reservationsCreated],
    ['visits_honored', report.attribution.visitsHonored],
    ['active_conversions', report.attribution.activeConversions],
    ['estimated_revenue_eur', report.attribution.estimatedRevenue],
    ['confirmed_revenue_eur', report.attribution.confirmedRevenue],
    ['cost_eur', report.cost.amount],
    ['cost_status', report.cost.status],
  ];
  return `\uFEFFmetric,value\n${rows.map(([metric, value]) => `${csvCell(metric)},${csvCell(value)}`).join('\n')}\n`;
}

function amount(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function increment(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function isPricedUsage(metadata: unknown, estimatedCost: Prisma.Decimal): boolean {
  if (metadata && typeof metadata === 'object') {
    const status = (metadata as Record<string, unknown>).costStatus;
    if (status === 'PRICED') return true;
    if (status === 'UNPRICED') return false;
  }
  return !estimatedCost.isZero();
}

/**
 * Rebuilds the campaign view from immutable audience, message, link and
 * conversion rows. The result contains counters only; no contact data leaves
 * this service.
 */
export async function getMarketingCampaignReport(args: {
  restaurantId: string;
  campaignId: string;
}): Promise<MarketingCampaignReport> {
  const campaign = await db.marketingCampaign.findFirst({
    where: { id: args.campaignId, restaurantId: args.restaurantId },
    select: {
      id: true,
      name: true,
      channel: true,
      status: true,
      audienceCount: true,
      createdAt: true,
      completedAt: true,
    },
  });
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');

  const [audience, messages, links, conversions] = await Promise.all([
    db.campaignAudienceMember.findMany({
      where: { campaignId: campaign.id },
      select: { customerId: true },
    }),
    db.campaignMessage.findMany({
      where: { campaignId: campaign.id },
      select: { id: true, status: true },
    }),
    db.marketingAttributionLink.findMany({
      where: { campaignId: campaign.id },
      select: { clickedAt: true },
    }),
    db.marketingConversion.findMany({
      where: { campaignId: campaign.id },
      select: {
        customerId: true,
        reservationId: true,
        conversionType: true,
        active: true,
        reservation: { select: { estimatedRevenue: true, confirmedRevenue: true } },
      },
    }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const message of messages ?? []) increment(statusCounts, message.status);
  const customerIds = (audience ?? []).map((member) => member.customerId);
  const optOutEvents =
    customerIds.length === 0
      ? []
      : await db.marketingPermissionEvent.findMany({
          where: {
            restaurantId: args.restaurantId,
            customerId: { in: customerIds },
            status: 'OPTED_OUT',
            occurredAt: { gte: campaign.createdAt },
          },
          select: { customerId: true },
        });
  const unsubscribed = new Set((optOutEvents ?? []).map((event) => event.customerId)).size;

  let reservationsCreated = 0;
  let visitsHonored = 0;
  let activeConversions = 0;
  let estimatedRevenue = 0;
  let confirmedRevenue = 0;
  const revenueByReservation = new Map<string, { estimated: number; confirmed: number }>();
  for (const conversion of conversions ?? []) {
    if (conversion.active) activeConversions++;
    if (
      conversion.active &&
      conversion.conversionType === MarketingConversionType.RESERVATION_CREATED
    ) {
      reservationsCreated++;
    }
    if (
      conversion.active &&
      conversion.conversionType === MarketingConversionType.RESERVATION_HONORED
    ) {
      visitsHonored++;
    }
    if (conversion.active) {
      // A reservation can have both CREATED and HONORED conversions. Revenue
      // belongs to the reservation and must be counted once in the report.
      const revenueKey =
        conversion.reservationId ?? `${conversion.customerId}:${conversion.conversionType}`;
      const currentRevenue = revenueByReservation.get(revenueKey);
      const estimated = amount(conversion.reservation?.estimatedRevenue);
      const confirmed = amount(conversion.reservation?.confirmedRevenue);
      revenueByReservation.set(revenueKey, {
        estimated: Math.max(currentRevenue?.estimated ?? 0, estimated),
        confirmed: Math.max(currentRevenue?.confirmed ?? 0, confirmed),
      });
    }
  }
  for (const revenue of revenueByReservation.values()) {
    estimatedRevenue += revenue.estimated;
    confirmedRevenue += revenue.confirmed;
  }

  const clicked = (links ?? []).filter((link) => link.clickedAt !== null).length;
  const pending =
    (statusCounts[MarketingMessageStatus.PENDING] ?? 0) +
    (statusCounts[MarketingMessageStatus.SENDING] ?? 0);
  const excludedBeforeSend = statusCounts[MarketingMessageStatus.CANCELLED] ?? 0;

  const messageIds = (messages ?? []).map((message) => message.id);
  const usageEvents = messageIds.length
    ? await db.usageEvent.findMany({
        where: {
          restaurantId: args.restaurantId,
          sourceType: 'marketing_campaign',
          sourceId: { in: messageIds },
        },
        select: { estimatedCost: true, metadata: true },
      })
    : [];
  const usageCost = (usageEvents ?? []).reduce(
    (sum, event) => sum.add(event.estimatedCost),
    new Prisma.Decimal(0),
  );
  const pricedUsage = (usageEvents ?? []).filter((event) =>
    isPricedUsage(event.metadata, event.estimatedCost),
  ).length;
  const unpricedUsage = (usageEvents ?? []).length - pricedUsage;
  const costStatus: MarketingCampaignReport['cost']['status'] =
    usageEvents.length === 0
      ? 'NOT_AVAILABLE'
      : unpricedUsage === 0
        ? 'PRICED'
        : pricedUsage === 0
          ? 'UNPRICED'
          : 'PARTIAL';

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      channel: campaign.channel,
      status: campaign.status,
      createdAt: campaign.createdAt,
      completedAt: campaign.completedAt,
    },
    audience: {
      captured: audience?.length ?? 0,
      eligible: campaign.audienceCount,
      excludedBeforeSend,
    },
    delivery: {
      pending,
      accepted: statusCounts[MarketingMessageStatus.ACCEPTED] ?? 0,
      sent: statusCounts[MarketingMessageStatus.SENT] ?? 0,
      delivered: statusCounts[MarketingMessageStatus.DELIVERED] ?? 0,
      failed: statusCounts[MarketingMessageStatus.FAILED] ?? 0,
      cancelled: excludedBeforeSend,
      bounced: statusCounts[MarketingMessageStatus.BOUNCED] ?? 0,
      complained: statusCounts[MarketingMessageStatus.COMPLAINED] ?? 0,
      clicked,
      unsubscribed,
    },
    attribution: {
      reservationsCreated,
      visitsHonored,
      activeConversions,
      estimatedRevenue: Number(estimatedRevenue.toFixed(2)),
      confirmedRevenue: Number(confirmedRevenue.toFixed(2)),
    },
    cost: {
      amount: pricedUsage > 0 ? Number(usageCost.toFixed(6)) : null,
      currency: 'EUR',
      status: costStatus,
    },
  };
}
