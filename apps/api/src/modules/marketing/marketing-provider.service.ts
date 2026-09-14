import { createHash } from 'node:crypto';
import {
  MarketingMessageStatus,
  MarketingProviderReconciliationStatus,
  type PrismaClient,
} from '@prisma/client';
import { db } from '../../shared/db/client';

export type MarketingProvider = 'telnyx' | 'resend';

export type MarketingProviderEnvironment = Record<string, string | undefined>;

export type MarketingProviderChannelReadiness = {
  configured: boolean;
  callbackConfigured: boolean;
  /** Environment variable names only; never return their values. */
  missing: string[];
  callbackMissing: string[];
};

export type MarketingProviderReadiness = {
  sendsEnabled: boolean;
  sendGate: { enabled: boolean; missing: string[] };
  sms: MarketingProviderChannelReadiness;
  email: MarketingProviderChannelReadiness;
  whatsapp: MarketingProviderChannelReadiness;
};

function missingConfiguration(
  environment: MarketingProviderEnvironment,
  variables: string[],
): string[] {
  return variables.filter((variable) => !environment[variable]?.trim());
}

function channelReadiness(
  environment: MarketingProviderEnvironment,
  required: string[],
  callback: string[],
): MarketingProviderChannelReadiness {
  const missing = missingConfiguration(environment, required);
  const callbackMissing = missingConfiguration(environment, callback);
  return {
    configured: missing.length === 0,
    callbackConfigured: callbackMissing.length === 0,
    missing,
    callbackMissing,
  };
}

/** Return provider readiness without exposing keys, addresses or secrets. */
export function getMarketingProviderReadiness(
  environment: MarketingProviderEnvironment = process.env,
): MarketingProviderReadiness {
  const sendsEnabled = environment.MARKETING_SENDS_ENABLED === 'true';
  const sms = channelReadiness(
    environment,
    ['TELNYX_API_KEY', 'TELNYX_FROM_NUMBER'],
    ['TELNYX_PUBLIC_KEY'],
  );
  const email = channelReadiness(
    environment,
    ['RESEND_API_KEY', 'EMAIL_FROM'],
    ['RESEND_WEBHOOK_SECRET'],
  );
  const whatsappEnabled = environment.MARKETING_WHATSAPP_ENABLED === 'true';
  const whatsapp = whatsappEnabled
    ? channelReadiness(
        environment,
        ['TELNYX_API_KEY', 'TELNYX_WHATSAPP_FROM', 'TELNYX_MESSAGING_PROFILE_ID'],
        ['TELNYX_PUBLIC_KEY'],
      )
    : {
        configured: false,
        callbackConfigured: Boolean(environment.TELNYX_PUBLIC_KEY?.trim()),
        missing: ['MARKETING_WHATSAPP_ENABLED'],
        callbackMissing: missingConfiguration(environment, ['TELNYX_PUBLIC_KEY']),
      };
  return {
    sendsEnabled,
    sendGate: {
      enabled: sendsEnabled,
      missing: sendsEnabled ? [] : ['MARKETING_SENDS_ENABLED'],
    },
    sms,
    email,
    whatsapp,
  };
}

export type MarketingProviderEventInput = {
  provider: MarketingProvider;
  providerMessageId: string;
  eventType: string;
  providerStatus?: string;
  occurredAt?: Date;
  errorCode?: string;
  /** Hash of the signed body; never persist the body itself. */
  payloadHash?: string;
};

export type MarketingProviderEventResult = {
  matched: boolean;
  changed: boolean;
  status?: MarketingMessageStatus;
  campaignId?: string;
  customerId?: string;
  reconciliationId?: string;
};

type ProviderTransition = {
  status: MarketingMessageStatus;
  errorCode?: string;
};

type ProviderDb = Pick<
  PrismaClient,
  'campaignMessage' | 'marketingCampaign' | 'marketingProviderReconciliation'
> & {
  $transaction: <T>(callback: (tx: ProviderDb) => Promise<T>) => Promise<T>;
};

const TERMINAL_FAILURES = new Set<MarketingMessageStatus>([
  MarketingMessageStatus.FAILED,
  MarketingMessageStatus.BOUNCED,
  MarketingMessageStatus.COMPLAINED,
  MarketingMessageStatus.CANCELLED,
]);

/**
 * Provider events are deliberately reduced to a small internal state machine.
 * Unknown event names are ignored so a provider can add metadata events
 * without changing the campaign contract.
 */
export function normalizeMarketingProviderEvent(
  input: Pick<
    MarketingProviderEventInput,
    'provider' | 'eventType' | 'providerStatus' | 'errorCode'
  >,
): ProviderTransition | null {
  const errorCode = sanitizeProviderError(input.errorCode);

  if (input.provider === 'telnyx') {
    if (input.eventType === 'message.sent') {
      return { status: MarketingMessageStatus.SENT };
    }
    if (input.eventType !== 'message.finalized' && input.eventType !== 'message.delivered') {
      return null;
    }
    switch (input.providerStatus) {
      case 'delivered':
        return { status: MarketingMessageStatus.DELIVERED };
      case 'delivery_failed':
      case 'sending_failed':
      case 'expired':
      case 'failed':
        return { status: MarketingMessageStatus.FAILED, ...(errorCode ? { errorCode } : {}) };
      case 'sent':
      case 'queued':
      case 'sending':
      case 'delivery_unconfirmed':
      case 'dlr_timeout':
        return { status: MarketingMessageStatus.SENT };
      default:
        return null;
    }
  }

  switch (input.eventType) {
    case 'email.sent':
    case 'email.scheduled':
    case 'email.queued':
      return { status: MarketingMessageStatus.SENT };
    case 'email.delivered':
    case 'email.opened':
    case 'email.clicked':
      return { status: MarketingMessageStatus.DELIVERED };
    case 'email.bounced':
      return { status: MarketingMessageStatus.BOUNCED, ...(errorCode ? { errorCode } : {}) };
    case 'email.complained':
      return { status: MarketingMessageStatus.COMPLAINED, ...(errorCode ? { errorCode } : {}) };
    case 'email.failed':
    case 'email.suppressed':
      return { status: MarketingMessageStatus.FAILED, ...(errorCode ? { errorCode } : {}) };
    default:
      return null;
  }
}

function sanitizeProviderError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const sanitized = value
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]+/g, '_')
    .slice(0, 80);
  return sanitized || undefined;
}

function statusRank(status: MarketingMessageStatus): number {
  switch (status) {
    case MarketingMessageStatus.PENDING:
      return 0;
    case MarketingMessageStatus.SENDING:
      return 1;
    case MarketingMessageStatus.ACCEPTED:
      return 2;
    case MarketingMessageStatus.SENT:
      return 3;
    case MarketingMessageStatus.DELIVERED:
      return 4;
    case MarketingMessageStatus.FAILED:
    case MarketingMessageStatus.BOUNCED:
    case MarketingMessageStatus.COMPLAINED:
      return 5;
    case MarketingMessageStatus.CANCELLED:
      return 6;
    default:
      return -1;
  }
}

/**
 * Delivery callbacks can arrive late or more than once. A callback only moves
 * a message forward; a delivered message can never become sent/failed again,
 * and a repeated terminal event does not increment campaign counters twice.
 */
function canTransition(current: MarketingMessageStatus, next: MarketingMessageStatus): boolean {
  if (current === next) return false;
  if (current === MarketingMessageStatus.CANCELLED) return false;
  if (current === MarketingMessageStatus.DELIVERED) return false;
  if (TERMINAL_FAILURES.has(current)) return false;
  if (next === MarketingMessageStatus.FAILED || next === MarketingMessageStatus.BOUNCED) {
    return current === MarketingMessageStatus.ACCEPTED || current === MarketingMessageStatus.SENT;
  }
  if (next === MarketingMessageStatus.COMPLAINED) {
    return current === MarketingMessageStatus.ACCEPTED || current === MarketingMessageStatus.SENT;
  }
  return statusRank(next) > statusRank(current);
}

function asProviderDb(database: PrismaClient): ProviderDb {
  return database as unknown as ProviderDb;
}

function bounded(value: string | undefined, max: number): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function payloadHash(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : undefined;
}

function reconciliationEventKey(
  input: MarketingProviderEventInput,
  transition: ProviderTransition,
): string {
  const canonical = [
    input.provider,
    bounded(input.providerMessageId, 256) ?? '',
    bounded(input.eventType, 80) ?? '',
    bounded(input.providerStatus, 80) ?? '',
    transition.status,
    transition.errorCode ?? '',
  ].join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

async function recordUnknownProviderEvent(
  tx: ProviderDb,
  input: MarketingProviderEventInput,
  transition: ProviderTransition,
  occurredAt: Date,
): Promise<string> {
  const providerMessageId = bounded(input.providerMessageId, 256) ?? '';
  const eventType = bounded(input.eventType, 80) ?? 'unknown';
  const providerStatus = bounded(input.providerStatus, 80);
  const eventKey = reconciliationEventKey(input, transition);
  const result = await tx.marketingProviderReconciliation.upsert({
    where: { eventKey },
    create: {
      eventKey,
      provider: input.provider,
      providerMessageId,
      eventType,
      ...(providerStatus ? { providerStatus } : {}),
      ...(transition.errorCode ? { errorCode: transition.errorCode } : {}),
      ...(payloadHash(input.payloadHash) ? { payloadHash: payloadHash(input.payloadHash) } : {}),
      occurredAt,
      status: MarketingProviderReconciliationStatus.OPEN,
    },
    update: {
      attempts: { increment: 1 },
      lastSeenAt: occurredAt,
      ...(providerStatus ? { providerStatus } : {}),
      ...(transition.errorCode ? { errorCode: transition.errorCode } : {}),
      ...(payloadHash(input.payloadHash) ? { payloadHash: payloadHash(input.payloadHash) } : {}),
    },
    select: { id: true },
  });
  return result.id;
}

async function resolveProviderReconciliations(
  tx: ProviderDb,
  args: {
    provider: MarketingProvider;
    providerMessageId: string;
    campaignMessageId: string;
    restaurantId?: string;
    resolvedAt: Date;
    resolutionCode: string;
  },
): Promise<void> {
  const data = {
    status: MarketingProviderReconciliationStatus.RESOLVED,
    campaignMessageId: args.campaignMessageId,
    resolvedAt: args.resolvedAt,
    resolutionCode: args.resolutionCode,
    ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
  };
  await tx.marketingProviderReconciliation.updateMany({
    where: {
      provider: args.provider,
      providerMessageId: args.providerMessageId,
      status: MarketingProviderReconciliationStatus.OPEN,
    },
    data,
  });
}

/** Applies one signed provider event to the campaign message and its counters. */
export async function applyMarketingProviderEvent(
  input: MarketingProviderEventInput,
  database: PrismaClient = db,
): Promise<MarketingProviderEventResult> {
  const providerMessageId = input.providerMessageId.trim();
  if (!providerMessageId) return { matched: false, changed: false };
  const transition = normalizeMarketingProviderEvent(input);
  if (!transition) return { matched: false, changed: false };
  const occurredAt =
    input.occurredAt && !Number.isNaN(input.occurredAt.getTime()) ? input.occurredAt : new Date();
  const providerDb = asProviderDb(database);

  return providerDb.$transaction(async (tx) => {
    const message = await tx.campaignMessage.findFirst({
      where: { provider: input.provider, providerMessageId },
      select: {
        id: true,
        campaignId: true,
        customerId: true,
        status: true,
        acceptedAt: true,
        sentAt: true,
        deliveredAt: true,
        campaign: { select: { restaurantId: true } },
      },
    });
    if (!message) {
      const reconciliationId = await recordUnknownProviderEvent(tx, input, transition, occurredAt);
      return { matched: false, changed: false, reconciliationId };
    }
    if (!canTransition(message.status, transition.status)) {
      await resolveProviderReconciliations(tx, {
        provider: input.provider,
        providerMessageId,
        campaignMessageId: message.id,
        restaurantId: message.campaign?.restaurantId,
        resolvedAt: occurredAt,
        resolutionCode: 'ALREADY_APPLIED',
      });
      return {
        matched: true,
        changed: false,
        status: message.status,
        campaignId: message.campaignId,
        customerId: message.customerId,
      };
    }

    const data: Record<string, unknown> = { status: transition.status };
    if (transition.errorCode) data.errorCode = transition.errorCode;
    if (transition.status === MarketingMessageStatus.SENT && !message.sentAt) {
      data.sentAt = occurredAt;
    }
    if (transition.status === MarketingMessageStatus.DELIVERED) {
      data.deliveredAt = message.deliveredAt ?? occurredAt;
      if (!message.sentAt) data.sentAt = occurredAt;
      if (!message.acceptedAt) data.acceptedAt = occurredAt;
    }

    const updated = await tx.campaignMessage.updateMany({
      where: { id: message.id, status: message.status },
      data,
    });
    if (updated.count !== 1) {
      await resolveProviderReconciliations(tx, {
        provider: input.provider,
        providerMessageId,
        campaignMessageId: message.id,
        restaurantId: message.campaign?.restaurantId,
        resolvedAt: occurredAt,
        resolutionCode: 'RACE_ALREADY_APPLIED',
      });
      return {
        matched: true,
        changed: false,
        status: message.status,
        campaignId: message.campaignId,
        customerId: message.customerId,
      };
    }

    await resolveProviderReconciliations(tx, {
      provider: input.provider,
      providerMessageId,
      campaignMessageId: message.id,
      restaurantId: message.campaign?.restaurantId,
      resolvedAt: occurredAt,
      resolutionCode: 'APPLIED',
    });

    if (transition.status === MarketingMessageStatus.DELIVERED) {
      await tx.marketingCampaign.update({
        where: { id: message.campaignId },
        data: { deliveredCount: { increment: 1 } },
      });
    } else if (
      transition.status === MarketingMessageStatus.FAILED ||
      transition.status === MarketingMessageStatus.BOUNCED ||
      transition.status === MarketingMessageStatus.COMPLAINED
    ) {
      await tx.marketingCampaign.update({
        where: { id: message.campaignId },
        data: {
          failedCount: { increment: 1 },
          lastErrorCode: transition.errorCode ?? `PROVIDER_${transition.status}`,
        },
      });
    }

    return {
      matched: true,
      changed: true,
      status: transition.status,
      campaignId: message.campaignId,
      customerId: message.customerId,
    };
  });
}

export type MarketingProviderReconciliationView = {
  id: string;
  eventKey: string;
  provider: string;
  providerMessageId: string;
  eventType: string;
  providerStatus: string | null;
  errorCode: string | null;
  payloadHash: string | null;
  occurredAt: Date;
  status: MarketingProviderReconciliationStatus;
  restaurantId: string | null;
  campaignMessageId: string | null;
  attempts: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  resolutionCode: string | null;
};

const RECONCILIATION_SELECT = {
  id: true,
  eventKey: true,
  provider: true,
  providerMessageId: true,
  eventType: true,
  providerStatus: true,
  errorCode: true,
  payloadHash: true,
  occurredAt: true,
  status: true,
  restaurantId: true,
  campaignMessageId: true,
  attempts: true,
  firstSeenAt: true,
  lastSeenAt: true,
  resolvedAt: true,
  resolutionCode: true,
} as const;

export async function listMarketingProviderReconciliations(args: {
  status?: MarketingProviderReconciliationStatus;
  provider?: MarketingProvider;
  restaurantId?: string;
  limit?: number;
  database?: PrismaClient;
}): Promise<MarketingProviderReconciliationView[]> {
  const rows = await (args.database ?? db).marketingProviderReconciliation.findMany({
    where: {
      ...(args.status ? { status: args.status } : {}),
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
    },
    orderBy: [{ status: 'asc' }, { lastSeenAt: 'asc' }],
    take: Math.min(Math.max(args.limit ?? 100, 1), 500),
    select: RECONCILIATION_SELECT,
  });
  return rows as MarketingProviderReconciliationView[];
}

export type MarketingProviderReconciliationSummary = {
  scanned: number;
  resolved: number;
  stillOpen: number;
};

/** Attach open callbacks to messages that appeared after the callback. */
export async function reconcileMarketingProviderEvents(args: {
  provider?: MarketingProvider;
  restaurantId?: string;
  limit?: number;
  database?: PrismaClient;
  now?: Date;
}): Promise<MarketingProviderReconciliationSummary> {
  const database = args.database ?? db;
  const rows = await listMarketingProviderReconciliations({
    status: MarketingProviderReconciliationStatus.OPEN,
    provider: args.provider,
    limit: args.limit,
    database,
  });
  let resolved = 0;
  for (const row of rows) {
    const message = await database.campaignMessage.findFirst({
      where: { provider: row.provider, providerMessageId: row.providerMessageId },
      select: {
        id: true,
        campaignId: true,
        customerId: true,
        status: true,
        acceptedAt: true,
        sentAt: true,
        deliveredAt: true,
        campaign: { select: { restaurantId: true } },
      },
    });
    if (!message || (args.restaurantId && message.campaign.restaurantId !== args.restaurantId))
      continue;

    const result = await applyMarketingProviderEvent(
      {
        provider: row.provider as MarketingProvider,
        providerMessageId: row.providerMessageId,
        eventType: row.eventType,
        providerStatus: row.providerStatus ?? undefined,
        errorCode: row.errorCode ?? undefined,
        occurredAt: row.occurredAt,
        payloadHash: row.payloadHash ?? undefined,
      },
      database,
    );
    if (!result.matched) continue;
    const updated = await database.marketingProviderReconciliation.updateMany({
      where: { id: row.id, status: MarketingProviderReconciliationStatus.OPEN },
      data: {
        status: MarketingProviderReconciliationStatus.RESOLVED,
        restaurantId: message.campaign.restaurantId,
        campaignMessageId: message.id,
        resolvedAt: args.now ?? new Date(),
        resolutionCode: result.changed ? 'RECONCILED_APPLIED' : 'RECONCILED_ALREADY_APPLIED',
      },
    });
    resolved += updated.count;
  }
  return { scanned: rows.length, resolved, stillOpen: rows.length - resolved };
}

export async function ignoreMarketingProviderReconciliation(args: {
  id: string;
  reason: string;
  database?: PrismaClient;
  now?: Date;
}): Promise<void> {
  const reason = args.reason
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]+/g, '_')
    .slice(0, 80);
  if (!reason) throw new Error('RECONCILIATION_REASON_REQUIRED');
  const updated = await (args.database ?? db).marketingProviderReconciliation.updateMany({
    where: { id: args.id.trim(), status: MarketingProviderReconciliationStatus.OPEN },
    data: {
      status: MarketingProviderReconciliationStatus.IGNORED,
      resolvedAt: args.now ?? new Date(),
      resolutionCode: `MANUAL_${reason}`,
    },
  });
  if (updated.count !== 1) throw new Error('RECONCILIATION_NOT_FOUND');
}
