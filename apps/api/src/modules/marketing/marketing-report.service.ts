import { MarketingMessageStatus, MarketingConversionType, Prisma } from '@prisma/client';
import { db } from '../../shared/db/client';
import { ACTIVE_RESERVATION_STATES } from '../../shared/reservations/capacity';
import { HOLDOUT_INCLUSION_REASON, TARGET_SERVICE_FULL } from './marketing-campaign.service';
import { HOLDOUT_MIN_CUSTOMERS } from './fill-service.service';
import { TIER_PROBABILITY, type FillTier } from './fill-targeting';

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
  /** Présent seulement pour une campagne de remplissage (service visé). */
  serviceFill?: ServiceFillReport;
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
      startedAt: true,
      targetServiceStart: true,
      targetServiceEnd: true,
      lastErrorCode: true,
    },
  });
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');

  const [audience, messages, links, conversions] = await Promise.all([
    db.campaignAudienceMember.findMany({
      where: { campaignId: campaign.id },
      select: { customerId: true, inclusionReason: true, snapshot: true },
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

  const serviceFill = await serviceFillReport({
    restaurantId: args.restaurantId,
    startedAt: campaign.startedAt,
    targetServiceStart: campaign.targetServiceStart,
    targetServiceEnd: campaign.targetServiceEnd,
    truncated: campaign.lastErrorCode === TARGET_SERVICE_FULL,
    members: audience ?? [],
  });

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
    ...(serviceFill ? { serviceFill } : {}),
  };
}

export type ServiceFillGroup = {
  customers: number;
  covers: number;
  coversPerCustomer: number;
  /** Clients distincts ayant réservé le service visé. */
  reservedCustomers: number;
};

type TierGroup = { customers: number; reservedCustomers: number };

export type ServiceFillReport = {
  service: { start: Date; end: Date };
  treated: ServiceFillGroup;
  holdout: ServiceFillGroup;
  /** Couverts par client : destinataires moins témoin. */
  difference: number;
  /** Faux sous HOLDOUT_MIN_CUSTOMERS clients dans le témoin, ou si l'envoi a été tronqué. */
  conclusive: boolean;
  /** Part des clients qui ont réservé, destinataires moins témoin, en points (marge à 95 %). */
  effect: { difference: number; margin95: number } | null;
  /** Anciennes campagnes : les membres sans palier valide n'y figurent pas. */
  byTier: Partial<Record<FillTier, { treated: TierGroup; holdout: TierGroup }>>;
  /** Couverts par client sur 30 jours après l'envoi, tous services ; null avant l'échéance. */
  netEffect30d: {
    treatedCoversPerCustomer: number;
    holdoutCoversPerCustomer: number;
    difference: number;
  } | null;
  /** Envoi réduit : le service s'est rempli avant la fin. */
  truncated: boolean;
};

const NET_EFFECT_DAYS = 30;

function tierOfSnapshot(snapshot: unknown): FillTier | null {
  const tier = (snapshot as { tier?: unknown } | null)?.tier;
  return typeof tier === 'string' && Object.hasOwn(TIER_PROBABILITY, tier)
    ? (tier as FillTier)
    : null;
}

/**
 * Couverts réservés pour le service visé, par client, pour les destinataires et pour le témoin. Les
 * réservations comptées sont celles créées entre l'envoi et la fin du service ; téléphone compris.
 */
async function serviceFillReport(args: {
  restaurantId: string;
  startedAt: Date | null;
  targetServiceStart: Date | null;
  targetServiceEnd: Date | null;
  truncated: boolean;
  members: Array<{ customerId: string; inclusionReason: string; snapshot?: unknown }>;
}): Promise<ServiceFillReport | undefined> {
  const { startedAt, targetServiceStart: start, targetServiceEnd: end } = args;
  if (!start || !end) return undefined;
  const isHoldout = (member: { inclusionReason: string }) =>
    member.inclusionReason === HOLDOUT_INCLUSION_REASON;
  const treatedIds = new Set(
    args.members.filter((member) => !isHoldout(member)).map((member) => member.customerId),
  );
  const holdoutIds = new Set(args.members.filter(isHoldout).map((member) => member.customerId));
  const states = [...ACTIVE_RESERVATION_STATES, 'HONORED'] as const;
  const customerIds = args.members.map((member) => member.customerId);
  // Pas encore envoyée : aucune réservation ne peut être attribuée à l'envoi.
  const rows =
    startedAt && args.members.length > 0
      ? await db.reservation.findMany({
          where: {
            restaurantId: args.restaurantId,
            isTest: false,
            customerId: { in: customerIds },
            state: { in: [...states] },
            reservedAt: { gte: start, lt: end },
            createdAt: { gte: startedAt, lt: end },
          },
          select: { customerId: true, partySize: true },
        })
      : [];
  const reserved = new Set(rows.flatMap((row) => (row.customerId ? [row.customerId] : [])));
  const group = (ids: Set<string>): ServiceFillGroup => {
    const covers = rows.reduce(
      (sum, row) => (row.customerId && ids.has(row.customerId) ? sum + row.partySize : sum),
      0,
    );
    const coversPerCustomer = ids.size === 0 ? 0 : covers / ids.size;
    return {
      customers: ids.size,
      covers,
      coversPerCustomer: Number(coversPerCustomer.toFixed(2)),
      reservedCustomers: [...ids].filter((id) => reserved.has(id)).length,
    };
  };
  const treated = group(treatedIds);
  const holdout = group(holdoutIds);

  let effect: ServiceFillReport['effect'] = null;
  // Brouillon (jamais envoyé) : aucun effet à mesurer, ni « entre 0 et 0 points ».
  if (startedAt && treated.customers > 0 && holdout.customers > 0) {
    const p1 = treated.reservedCustomers / treated.customers;
    const p2 = holdout.reservedCustomers / holdout.customers;
    const margin =
      1.96 * Math.sqrt((p1 * (1 - p1)) / treated.customers + (p2 * (1 - p2)) / holdout.customers);
    effect = {
      difference: Number(((p1 - p2) * 100).toFixed(1)),
      margin95: Number((margin * 100).toFixed(1)),
    };
  }

  const byTier: ServiceFillReport['byTier'] = {};
  for (const member of args.members) {
    const tier = tierOfSnapshot(member.snapshot);
    if (!tier) continue;
    const entry = (byTier[tier] ??= {
      treated: { customers: 0, reservedCustomers: 0 },
      holdout: { customers: 0, reservedCustomers: 0 },
    });
    const side = isHoldout(member) ? entry.holdout : entry.treated;
    side.customers += 1;
    if (reserved.has(member.customerId)) side.reservedCustomers += 1;
  }

  // Effet net : mêmes clients, tous services, 30 jours après l'envoi, une fois l'échéance passée.
  // Une campagne tronquée (service rempli) ne sert pas de mesure.
  let netEffect30d: ServiceFillReport['netEffect30d'] = null;
  if (startedAt && !args.truncated && treated.customers > 0 && holdout.customers > 0) {
    const deadline = new Date(startedAt.getTime() + NET_EFFECT_DAYS * 24 * 3600_000);
    if (deadline <= new Date()) {
      const netRows = await db.reservation.findMany({
        where: {
          restaurantId: args.restaurantId,
          isTest: false,
          customerId: { in: customerIds },
          state: { in: [...states] },
          reservedAt: { gte: startedAt, lt: deadline },
          createdAt: { gte: startedAt },
        },
        select: { customerId: true, partySize: true },
      });
      const perCustomer = (ids: Set<string>) =>
        Number(
          (
            netRows.reduce(
              (sum, row) => (row.customerId && ids.has(row.customerId) ? sum + row.partySize : sum),
              0,
            ) / ids.size
          ).toFixed(2),
        );
      const treatedCovers = perCustomer(treatedIds);
      const holdoutCovers = perCustomer(holdoutIds);
      netEffect30d = {
        treatedCoversPerCustomer: treatedCovers,
        holdoutCoversPerCustomer: holdoutCovers,
        difference: Number((treatedCovers - holdoutCovers).toFixed(2)),
      };
    }
  }

  return {
    service: { start, end },
    treated,
    holdout,
    difference: Number((treated.coversPerCustomer - holdout.coversPerCustomer).toFixed(2)),
    conclusive: holdout.customers >= HOLDOUT_MIN_CUSTOMERS && !args.truncated,
    effect,
    byTier,
    netEffect30d,
    truncated: args.truncated,
  };
}
