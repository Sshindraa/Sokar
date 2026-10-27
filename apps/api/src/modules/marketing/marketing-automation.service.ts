import { createHash } from 'node:crypto';
import {
  MarketingAutomationDispatchStatus,
  MarketingAutomationType,
  MarketingCampaignStatus,
  Prisma,
  type MarketingAutomation,
  type MarketingCampaign,
} from '@prisma/client';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import {
  CAMPAIGN_CHANNELS,
  ensureCampaignMessages,
  MAX_SENDS_PER_FREQUENCY_WINDOW,
  remainingDailyEmailBudget,
  validateMarketingTemplate,
} from './marketing-campaign.service';
import { loadOptedOutCustomerIds } from './marketing-opt-out.service';
import {
  loadLegacyMarketingOptIns,
  resolveMarketingPermission,
  type MarketingChannelCode,
} from './marketing-permission.service';

export const MARKETING_AUTOMATION_TYPES = [
  'AFTER_FIRST_HONORED',
  'DORMANT',
  'BIRTHDAY',
] as const satisfies readonly MarketingAutomationType[];

export type MarketingAutomationTypeCode = (typeof MARKETING_AUTOMATION_TYPES)[number];

export const MAX_AUTOMATION_CANDIDATES = 10_000;

const AutomationConfigInputSchema = z
  .object({
    bodyTemplate: z.string().trim().min(1).max(10_000),
    subject: z.string().trim().max(200).nullable().optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    delayHours: z.coerce.number().int().min(0).max(168).optional(),
    inactiveDays: z.coerce.number().int().min(30).max(365).optional(),
    daysBefore: z.coerce.number().int().min(0).max(30).optional(),
    sendHour: z.coerce.number().int().min(0).max(23).optional(),
  })
  .strict();

export type MarketingAutomationConfigInput = z.input<typeof AutomationConfigInputSchema>;

export type MarketingAutomationConfig = {
  bodyTemplate: string;
  subject: string | null;
  timezone: string;
  delayHours?: number;
  inactiveDays?: number;
  daysBefore?: number;
  sendHour?: number;
};

export type MarketingAutomationCandidate = {
  customerId: string;
  name: string | null;
  phone: string;
  emailNormalized: string | null;
  triggerKey: string;
  occurredAt: Date;
  inclusionReason: string;
};

function normalizeChannel(value: string): MarketingChannelCode {
  if (!(CAMPAIGN_CHANNELS as readonly string[]).includes(value)) {
    throw new Error('unsupported marketing channel');
  }
  return value as MarketingChannelCode;
}

function validDate(value: Date | undefined, field: string): Date {
  const date = value ?? new Date();
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be valid`);
  return date;
}

function assertTimeZone(value: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value }).format();
  } catch {
    throw new Error('timezone must be a valid IANA timezone');
  }
  return value;
}

function actorHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Validate and normalize one of the three deliberately bounded configs. */
export function parseMarketingAutomationConfig(
  type: MarketingAutomationTypeCode,
  channelInput: string,
  input: unknown,
): MarketingAutomationConfig {
  const channel = normalizeChannel(channelInput);
  const raw = AutomationConfigInputSchema.parse(input);
  const content = validateMarketingTemplate({
    channel,
    subject: raw.subject,
    bodyTemplate: raw.bodyTemplate,
  });
  const timezone = assertTimeZone(raw.timezone?.trim() || 'Europe/Paris');
  if (type === 'AFTER_FIRST_HONORED') {
    return {
      ...content,
      timezone,
      delayHours: raw.delayHours ?? 24,
    };
  }
  if (type === 'DORMANT') {
    return {
      ...content,
      timezone,
      inactiveDays: raw.inactiveDays ?? 90,
    };
  }
  return {
    ...content,
    timezone,
    daysBefore: raw.daysBefore ?? 7,
    sendHour: raw.sendHour ?? 10,
  };
}

export async function upsertMarketingAutomation(args: {
  restaurantId: string;
  type: MarketingAutomationTypeCode;
  channel: MarketingChannelCode;
  config: unknown;
  enabled: boolean;
}): Promise<MarketingAutomation> {
  const config = parseMarketingAutomationConfig(args.type, args.channel, args.config);
  return db.marketingAutomation.upsert({
    where: {
      restaurantId_type: {
        restaurantId: args.restaurantId,
        type: args.type as MarketingAutomationType,
      },
    },
    create: {
      restaurantId: args.restaurantId,
      type: args.type as MarketingAutomationType,
      channel: args.channel,
      config: config as Prisma.InputJsonValue,
      enabled: args.enabled,
      version: 1,
    },
    update: {
      channel: args.channel,
      config: config as Prisma.InputJsonValue,
      enabled: args.enabled,
      version: { increment: 1 },
    },
  });
}

export async function listMarketingAutomations(args: {
  restaurantId: string;
}): Promise<MarketingAutomation[]> {
  return db.marketingAutomation.findMany({
    where: { restaurantId: args.restaurantId },
    orderBy: [{ type: 'asc' }, { id: 'asc' }],
  });
}

function datePartsInTimeZone(
  date: Date,
  timezone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return {
    year: values.get('year') ?? date.getUTCFullYear(),
    month: values.get('month') ?? date.getUTCMonth() + 1,
    day: values.get('day') ?? date.getUTCDate(),
  };
}

function dayKey(parts: { year: number; month: number; day: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function ensureCandidateLimit<T>(rows: T[]): T[] {
  if (rows.length > MAX_AUTOMATION_CANDIDATES) {
    throw new Error(`AUTOMATION_CANDIDATES_TOO_LARGE:${MAX_AUTOMATION_CANDIDATES}`);
  }
  return rows;
}

/** Clé d'une occasion : un client n'est servi qu'une fois par automatisation et par occasion. */
function occasionKey(customerId: string, triggerKey: string): string {
  return `${customerId}|${triggerKey}`;
}

/**
 * Candidats d'une automatisation, sans les occasions déjà servies : un anniversaire ou un premier
 * passage n'est jamais renvoyé. Aucune écriture fournisseur ni campagne.
 */
export async function findMarketingAutomationCandidates(args: {
  automation: MarketingAutomation;
  now?: Date;
}): Promise<MarketingAutomationCandidate[]> {
  const candidates = await collectAutomationCandidates(args);
  if (candidates.length === 0) return candidates;
  const served = await db.marketingAutomationDispatch.findMany({
    where: {
      automationId: args.automation.id,
      customerId: { in: candidates.map((candidate) => candidate.customerId) },
    },
    select: { customerId: true, triggerKey: true },
  });
  const servedKeys = new Set(served.map((row) => occasionKey(row.customerId, row.triggerKey)));
  return candidates.filter(
    (candidate) => !servedKeys.has(occasionKey(candidate.customerId, candidate.triggerKey)),
  );
}

async function collectAutomationCandidates(args: {
  automation: MarketingAutomation;
  now?: Date;
}): Promise<MarketingAutomationCandidate[]> {
  const now = validDate(args.now, 'now');
  const type = args.automation.type as MarketingAutomationTypeCode;
  const config = parseMarketingAutomationConfig(
    type,
    String(args.automation.channel),
    args.automation.config,
  );
  const baseWhere = {
    restaurantId: args.automation.restaurantId,
    archivedAt: null,
    mergedIntoId: null,
  } as const;

  if (type === 'AFTER_FIRST_HONORED') {
    const cutoff = new Date(now.getTime() - (config.delayHours ?? 24) * 3_600_000);
    const rows = ensureCandidateLimit(
      await db.customer.findMany({
        where: {
          ...baseWhere,
          timelineEvents: {
            some: {
              eventType: 'RESERVATION_HONORED',
              occurredAt: { lte: cutoff },
            },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: MAX_AUTOMATION_CANDIDATES + 1,
        select: {
          id: true,
          name: true,
          phone: true,
          emailNormalized: true,
          timelineEvents: {
            where: { eventType: 'RESERVATION_HONORED', occurredAt: { lte: cutoff } },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
            take: 1,
            select: { id: true, sourceId: true, occurredAt: true },
          },
        },
      }),
    ) as Array<{
      id: string;
      name: string | null;
      phone: string;
      emailNormalized: string | null;
      timelineEvents: Array<{ id: string; sourceId: string | null; occurredAt: Date }>;
    }>;
    return rows.flatMap((row) => {
      const event = row.timelineEvents[0];
      if (!event) return [];
      return [
        {
          customerId: row.id,
          name: row.name,
          phone: row.phone,
          emailNormalized: row.emailNormalized,
          triggerKey: `first-honored:${event.sourceId ?? event.id}`,
          occurredAt: event.occurredAt,
          inclusionReason: 'AUTOMATION_AFTER_FIRST_HONORED',
        },
      ];
    });
  }

  if (type === 'DORMANT') {
    const cutoff = new Date(now.getTime() - (config.inactiveDays ?? 90) * 86_400_000);
    const rows = ensureCandidateLimit(
      await db.customer.findMany({
        where: {
          ...baseWhere,
          metricSnapshot: { is: { lastHonoredAt: { lt: cutoff } } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: MAX_AUTOMATION_CANDIDATES + 1,
        select: {
          id: true,
          name: true,
          phone: true,
          emailNormalized: true,
          metricSnapshot: { select: { lastHonoredAt: true, nextReservationAt: true } },
        },
      }),
    ) as Array<{
      id: string;
      name: string | null;
      phone: string;
      emailNormalized: string | null;
      metricSnapshot: { lastHonoredAt: Date | null; nextReservationAt: Date | null } | null;
    }>;
    return rows.flatMap((row) => {
      const metrics = row.metricSnapshot;
      if (!metrics?.lastHonoredAt) return [];
      if (metrics.nextReservationAt && metrics.nextReservationAt >= now) return [];
      return [
        {
          customerId: row.id,
          name: row.name,
          phone: row.phone,
          emailNormalized: row.emailNormalized,
          triggerKey: `dormant:${metrics.lastHonoredAt.toISOString()}:${config.inactiveDays ?? 90}`,
          occurredAt: metrics.lastHonoredAt,
          inclusionReason: 'AUTOMATION_DORMANT',
        },
      ];
    });
  }

  const daysBefore = config.daysBefore ?? 7;
  const timezone = config.timezone;
  const currentHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
  if (currentHour < (config.sendHour ?? 10)) return [];
  const rows = ensureCandidateLimit(
    await db.customer.findMany({
      where: {
        ...baseWhere,
        birthMonth: { not: null },
        birthDay: { not: null },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: MAX_AUTOMATION_CANDIDATES + 1,
      select: {
        id: true,
        name: true,
        phone: true,
        emailNormalized: true,
        birthMonth: true,
        birthDay: true,
      },
    }),
  ) as Array<{
    id: string;
    name: string | null;
    phone: string;
    emailNormalized: string | null;
    birthMonth: number | null;
    birthDay: number | null;
  }>;
  const days = new Map<string, { date: Date; key: string }>();
  for (let offset = 0; offset <= daysBefore; offset += 1) {
    const date = new Date(now.getTime() + offset * 86_400_000);
    const parts = datePartsInTimeZone(date, timezone);
    days.set(`${parts.month}-${parts.day}`, { date, key: dayKey(parts) });
  }
  return rows.flatMap((row) => {
    if (row.birthMonth === null || row.birthDay === null) return [];
    const match = days.get(`${row.birthMonth}-${row.birthDay}`);
    if (!match) return [];
    return [
      {
        customerId: row.id,
        name: row.name,
        phone: row.phone,
        emailNormalized: row.emailNormalized,
        triggerKey: `birthday:${match.key}`,
        occurredAt: match.date,
        inclusionReason: 'AUTOMATION_BIRTHDAY',
      },
    ];
  });
}

async function filterEligibleCandidates(args: {
  restaurantId: string;
  channel: MarketingChannelCode;
  candidates: MarketingAutomationCandidate[];
  now: Date;
}): Promise<MarketingAutomationCandidate[]> {
  if (args.candidates.length === 0) return [];
  const customerIds = args.candidates.map((candidate) => candidate.customerId);
  const [permissions, suppressions, frequencyWindows, legacyOptIns] = await Promise.all([
    db.marketingPermission.findMany({
      where: {
        restaurantId: args.restaurantId,
        customerId: { in: customerIds },
        channel: args.channel,
      },
      select: { customerId: true, status: true },
    }),
    db.marketingSuppression.findMany({
      where: {
        restaurantId: args.restaurantId,
        customerId: { in: customerIds },
        OR: [{ channel: null }, { channel: args.channel }],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: args.now } }] }],
      },
      select: { customerId: true },
    }),
    db.marketingFrequencyWindow.findMany({
      where: {
        restaurantId: args.restaurantId,
        customerId: { in: customerIds },
        channel: args.channel,
        windowStart: { lte: args.now },
        windowEnd: { gt: args.now },
      },
      select: { customerId: true, sendCount: true },
    }),
    loadLegacyMarketingOptIns({
      restaurantId: args.restaurantId,
      customers: args.candidates.map((candidate) => ({
        id: candidate.customerId,
        phone: candidate.phone,
      })),
    }),
  ]);
  const optOutRegister = await loadOptedOutCustomerIds({
    restaurantId: args.restaurantId,
    channel: args.channel,
    customers: args.candidates.map((candidate) => ({
      id: candidate.customerId,
      phone: candidate.phone,
      emailNormalized: candidate.emailNormalized,
    })),
  });
  const permissionByCustomer = new Map(
    (permissions ?? []).map((row) => [row.customerId, row.status]),
  );
  const suppressed = new Set((suppressions ?? []).map((row) => row.customerId));
  const capped = new Set(
    (frequencyWindows ?? [])
      .filter((row) => row.sendCount >= MAX_SENDS_PER_FREQUENCY_WINDOW)
      .map((row) => row.customerId),
  );
  return args.candidates.filter((candidate) => {
    const hasContact =
      args.channel === 'EMAIL' ? Boolean(candidate.emailNormalized) : Boolean(candidate.phone);
    if (!hasContact || suppressed.has(candidate.customerId) || capped.has(candidate.customerId))
      return false;
    if (optOutRegister.optedOut.has(candidate.customerId)) return false;
    return resolveMarketingPermission({
      channel: args.channel,
      channelStatus: permissionByCustomer.get(candidate.customerId),
      legacyMarketingOptIn: legacyOptIns.has(candidate.customerId),
    }).allowed;
  });
}

/** Ordre d'une occasion dans un lot : la plus proche d'abord, puis un ordre stable. */
function byDeadline(a: MarketingAutomationCandidate, b: MarketingAutomationCandidate): number {
  return (
    a.occurredAt.getTime() - b.occurredAt.getTime() || a.customerId.localeCompare(b.customerId)
  );
}

/**
 * Crée la campagne d'un lot, découpée sur le reste du budget e-mail du jour : ce qui ne tient pas n'est
 * pris par personne et reste candidat à la passe suivante. Une occasion déjà servie est ignorée par
 * `skipDuplicates`, sans interrompre la transaction.
 */
export async function createMarketingAutomationCampaign(args: {
  automation: MarketingAutomation;
  candidates: MarketingAutomationCandidate[];
  now?: Date;
}): Promise<{ campaign: MarketingCampaign | null; dispatchCount: number; deferred: number }> {
  if (args.candidates.length === 0) return { campaign: null, dispatchCount: 0, deferred: 0 };
  const now = validDate(args.now, 'now');
  const type = args.automation.type as MarketingAutomationTypeCode;
  const isEmail = String(args.automation.channel) === 'EMAIL';
  const config = parseMarketingAutomationConfig(
    type,
    String(args.automation.channel),
    args.automation.config,
  );
  return db.$transaction(async (tx) => {
    const ordered = [...args.candidates].sort(byDeadline);
    const room = isEmail ? await remainingDailyEmailBudget(tx, now) : ordered.length;
    const selected = ordered.slice(0, room);
    const deferred = ordered.length - selected.length;
    if (selected.length === 0) return { campaign: null, dispatchCount: 0, deferred };
    const campaign = await tx.marketingCampaign.create({
      data: {
        restaurantId: args.automation.restaurantId,
        name: `${type.toLowerCase().replaceAll('_', ' ')} — ${now.toISOString().slice(0, 10)}`,
        objective: `AUTOMATION_${type}`,
        channel: args.automation.channel,
        segmentId: null,
        status: MarketingCampaignStatus.READY,
        subject: config.subject,
        bodyTemplate: config.bodyTemplate,
        scheduledAt: now,
        timezone: config.timezone,
        audienceVersion: args.automation.version,
        audienceCount: 0,
        createdByHash: actorHash(`marketing-automation:${args.automation.id}`),
      },
    });
    await tx.marketingAutomationDispatch.createMany({
      data: selected.map((candidate) => ({
        automationId: args.automation.id,
        restaurantId: args.automation.restaurantId,
        customerId: candidate.customerId,
        triggerKey: candidate.triggerKey,
        campaignId: campaign.id,
        status: MarketingAutomationDispatchStatus.QUEUED,
        occurredAt: candidate.occurredAt,
      })),
      // Filet : une occasion servie entre-temps est ignorée sans interrompre la transaction.
      skipDuplicates: true,
    });
    const dispatches = await tx.marketingAutomationDispatch.findMany({
      where: { campaignId: campaign.id },
      select: { customerId: true, triggerKey: true, occurredAt: true },
    });
    if (dispatches.length === 0) {
      await tx.marketingCampaign.update({
        where: { id: campaign.id },
        data: {
          status: MarketingCampaignStatus.CANCELLED,
          completedAt: now,
          lastErrorCode: 'AUTOMATION_ALREADY_DISPATCHED',
        },
      });
      return { campaign: null, dispatchCount: 0, deferred };
    }
    await tx.campaignAudienceMember.createMany({
      data: dispatches.map((dispatch) => {
        const candidate = selected.find(
          (item) =>
            item.customerId === dispatch.customerId && item.triggerKey === dispatch.triggerKey,
        );
        return {
          campaignId: campaign.id,
          customerId: dispatch.customerId,
          audienceVersion: args.automation.version,
          inclusionReason: candidate?.inclusionReason ?? `AUTOMATION_${type}`,
          snapshot: {
            automationId: args.automation.id,
            automationType: type,
            triggerKey: dispatch.triggerKey,
            occurredAt: dispatch.occurredAt.toISOString(),
          } as Prisma.InputJsonValue,
          capturedAt: now,
        };
      }),
    });
    await ensureCampaignMessages(
      campaign.id,
      String(args.automation.channel) as MarketingChannelCode,
      tx,
    );
    const updated = await tx.marketingCampaign.update({
      where: { id: campaign.id },
      data: { audienceCount: dispatches.length },
    });
    return { campaign: updated, dispatchCount: dispatches.length, deferred };
  });
}

export async function evaluateMarketingAutomation(args: {
  automation: MarketingAutomation;
  now?: Date;
}): Promise<{
  candidateCount: number;
  eligibleCount: number;
  campaignId: string | null;
  deferred: number;
}> {
  const now = validDate(args.now, 'now');
  const candidates = await findMarketingAutomationCandidates({ automation: args.automation, now });
  const eligible = await filterEligibleCandidates({
    restaurantId: args.automation.restaurantId,
    channel: String(args.automation.channel) as MarketingChannelCode,
    candidates,
    now,
  });
  const created = await createMarketingAutomationCampaign({
    automation: args.automation,
    candidates: eligible,
    now,
  });
  await db.marketingAutomation.update({
    where: { id: args.automation.id },
    data: { lastEvaluatedAt: now },
  });
  return {
    candidateCount: candidates.length,
    eligibleCount: eligible.length,
    campaignId: created.campaign?.id ?? null,
    deferred: created.deferred,
  };
}

/** Ordre dans une passe : les fenêtres bornées (anniversaire) passent avant les autres, partout. */
export function automationPriority(automation: Pick<MarketingAutomation, 'type'>): number {
  return automation.type === 'BIRTHDAY' ? 0 : 1;
}

const budgetWarnedOn = new Map<string, string>();

/** Un seul avertissement par automatisation et par jour quand le budget e-mail est atteint. */
export function warnBudgetDeferralOnce(
  automation: Pick<MarketingAutomation, 'id' | 'type'>,
  deferred: number,
  now: Date,
): void {
  const day = now.toISOString().slice(0, 10);
  if (budgetWarnedOn.get(automation.id) === day) return;
  budgetWarnedOn.set(automation.id, day);
  logger.warn(
    { automationId: automation.id, type: automation.type, deferred },
    'marketing automation deferred: daily email budget reached',
  );
}

export async function evaluateMarketingAutomations(args: {
  restaurantId?: string;
  now?: Date;
}): Promise<{ automations: number; campaigns: number; eligible: number }> {
  const now = args.now ?? new Date();
  const automations = (
    await db.marketingAutomation.findMany({
      where: {
        enabled: true,
        ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
      },
      orderBy: [{ restaurantId: 'asc' }, { type: 'asc' }],
    })
  ).sort((a, b) => automationPriority(a) - automationPriority(b));
  let campaigns = 0;
  let eligible = 0;
  for (const automation of automations) {
    const result = await evaluateMarketingAutomation({ automation, now });
    if (result.campaignId) campaigns += 1;
    eligible += result.eligibleCount;
    if (result.deferred > 0) warnBudgetDeferralOnce(automation, result.deferred, now);
  }
  return { automations: automations.length, campaigns, eligible };
}
