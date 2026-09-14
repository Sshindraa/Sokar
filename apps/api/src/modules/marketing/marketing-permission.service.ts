import { createHash } from 'node:crypto';
import {
  MarketingChannel,
  MarketingPermissionStatus,
  type MarketingPermission,
} from '@prisma/client';
import { db } from '../../shared/db/client';
import {
  appendCustomerTimelineEvent,
  buildCustomerTimelineDedupeKey,
} from '../customers/customer-crm.service';

export const MARKETING_CHANNELS = ['SMS', 'EMAIL', 'WHATSAPP'] as const;
export type MarketingChannelCode = (typeof MARKETING_CHANNELS)[number];

export type MarketingPermissionInput = {
  restaurantId: string;
  customerId: string;
  channel: MarketingChannelCode;
  status: MarketingPermissionStatus;
  source: string;
  proofVersion?: string | null;
  /** Raw proof is hashed before it reaches Postgres. Never log or persist it. */
  proof?: string | null;
  /** Allows a trusted import to provide an already calculated SHA-256 hash. */
  proofHash?: string | null;
  occurredAt?: Date;
};

export type MarketingPermissionResolution = {
  allowed: boolean;
  status: MarketingPermissionStatus;
  source: 'CHANNEL_PERMISSION' | 'LEGACY_CUSTOMER_CONSENT' | 'NONE';
  reason: 'OPTED_IN' | 'OPTED_OUT' | 'UNKNOWN' | 'NO_LEGACY_CONSENT';
};

const SAFE_HASH = /^[0-9a-f]{64}$/;

function normalizeText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function hashProof(proof: string): string {
  return createHash('sha256').update(proof.trim()).digest('hex');
}

function normalizeProofHash(input: MarketingPermissionInput): string | null {
  const suppliedHash = input.proofHash?.trim().toLowerCase();
  if (suppliedHash) {
    if (!SAFE_HASH.test(suppliedHash)) throw new Error('proofHash must be a SHA-256 hex digest');
    return suppliedHash;
  }
  const proof = input.proof?.trim();
  return proof ? hashProof(proof) : null;
}

function normalizeOccurredAt(value: Date | undefined): Date {
  const occurredAt = value ?? new Date();
  if (Number.isNaN(occurredAt.getTime())) throw new Error('occurredAt must be a valid date');
  return occurredAt;
}

function normalizeChannel(value: MarketingChannelCode): MarketingChannel {
  if (!MARKETING_CHANNELS.includes(value)) throw new Error('unsupported marketing channel');
  return value as MarketingChannel;
}

/**
 * Resolves an eventual channel permission without making a provider call.
 * During the migration, an explicit legacy marketingOptIn can temporarily
 * grant SMS/email only. WhatsApp always requires a channel-specific opt-in.
 */
export function resolveMarketingPermission(args: {
  channel: MarketingChannelCode;
  channelStatus?: MarketingPermissionStatus | null;
  legacyMarketingOptIn: boolean;
}): MarketingPermissionResolution {
  if (args.channelStatus) {
    if (args.channelStatus === MarketingPermissionStatus.OPTED_IN) {
      return {
        allowed: true,
        status: args.channelStatus,
        source: 'CHANNEL_PERMISSION',
        reason: 'OPTED_IN',
      };
    }
    return {
      allowed: false,
      status: args.channelStatus,
      source: 'CHANNEL_PERMISSION',
      reason: args.channelStatus === MarketingPermissionStatus.OPTED_OUT ? 'OPTED_OUT' : 'UNKNOWN',
    };
  }

  if (args.channel !== 'WHATSAPP' && args.legacyMarketingOptIn) {
    return {
      allowed: true,
      status: MarketingPermissionStatus.OPTED_IN,
      source: 'LEGACY_CUSTOMER_CONSENT',
      reason: 'OPTED_IN',
    };
  }

  return {
    allowed: false,
    status: MarketingPermissionStatus.UNKNOWN,
    source: 'NONE',
    reason: 'NO_LEGACY_CONSENT',
  };
}

async function assertCustomerTenant(customerId: string, restaurantId: string): Promise<void> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, restaurantId, archivedAt: null },
    select: { id: true },
  });
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
}

export async function upsertMarketingPermission(
  input: MarketingPermissionInput,
): Promise<MarketingPermission> {
  await assertCustomerTenant(input.customerId, input.restaurantId);

  const channel = normalizeChannel(input.channel);
  const source = normalizeText(input.source, 'source', 80);
  const occurredAt = normalizeOccurredAt(input.occurredAt);
  const proofVersion = input.proofVersion?.trim() || null;
  if (proofVersion && proofVersion.length > 80) {
    throw new Error('proofVersion must contain at most 80 characters');
  }
  const proofHash = normalizeProofHash(input);

  if (input.status === MarketingPermissionStatus.OPTED_IN && (!proofVersion || !proofHash)) {
    throw new Error('channel opt-in requires proofVersion and proof');
  }

  const permission = await db.marketingPermission.upsert({
    where: { customerId_channel: { customerId: input.customerId, channel } },
    create: {
      restaurantId: input.restaurantId,
      customerId: input.customerId,
      channel,
      status: input.status,
      source,
      proofVersion,
      proofHash,
      consentedAt: input.status === MarketingPermissionStatus.OPTED_IN ? occurredAt : null,
      withdrawnAt: input.status === MarketingPermissionStatus.OPTED_OUT ? occurredAt : null,
    },
    update: {
      status: input.status,
      source,
      proofVersion,
      proofHash,
      consentedAt: input.status === MarketingPermissionStatus.OPTED_IN ? occurredAt : null,
      withdrawnAt: input.status === MarketingPermissionStatus.OPTED_OUT ? occurredAt : null,
    },
  });

  await db.marketingPermissionEvent.create({
    data: {
      restaurantId: input.restaurantId,
      customerId: input.customerId,
      permissionId: permission.id,
      channel,
      status: input.status,
      source,
      proofVersion,
      proofHash,
      occurredAt,
    },
  });

  await appendCustomerTimelineEvent({
    restaurantId: input.restaurantId,
    customerId: input.customerId,
    eventType: 'MARKETING_PERMISSION_UPDATED',
    sourceType: 'marketing_permission',
    sourceId: `${permission.id}:${occurredAt.toISOString()}`,
    dedupeKey: buildCustomerTimelineDedupeKey({
      restaurantId: input.restaurantId,
      customerId: input.customerId,
      eventType: 'MARKETING_PERMISSION_UPDATED',
      sourceType: 'marketing_permission',
      sourceId: `${permission.id}:${occurredAt.toISOString()}`,
    }),
    occurredAt,
    summaryCode: 'marketing.permission_updated',
    metadata: { channel, status: input.status, source },
  });

  return permission;
}

export async function withdrawMarketingPermission(args: {
  restaurantId: string;
  customerId: string;
  channel: MarketingChannelCode;
  source?: string;
  occurredAt?: Date;
}): Promise<MarketingPermission> {
  return upsertMarketingPermission({
    restaurantId: args.restaurantId,
    customerId: args.customerId,
    channel: args.channel,
    status: MarketingPermissionStatus.OPTED_OUT,
    source: args.source ?? 'UNSUBSCRIBE',
    occurredAt: args.occurredAt,
  });
}

export async function listMarketingPermissions(args: {
  restaurantId: string;
  customerId: string;
}): Promise<MarketingPermission[]> {
  await assertCustomerTenant(args.customerId, args.restaurantId);
  return db.marketingPermission.findMany({
    where: { restaurantId: args.restaurantId, customerId: args.customerId },
    orderBy: { channel: 'asc' },
  });
}

/**
 * Build a legacy consent lookup for an already loaded customer set. Hashes
 * are the only values sent to CustomerConsent, so campaign queries never
 * put phone numbers in SQL logs or audit payloads.
 */
export async function loadLegacyMarketingOptIns(args: {
  restaurantId: string;
  customers: Array<{ id: string; phone: string }>;
}): Promise<Set<string>> {
  if (args.customers.length === 0) return new Set();
  const subjectHashes = args.customers.map((customer) =>
    createHash('sha256').update(customer.phone.toLowerCase().trim()).digest('hex'),
  );
  const consents = await db.customerConsent.findMany({
    where: {
      restaurantId: args.restaurantId,
      subjectHash: { in: subjectHashes },
      marketingOptIn: true,
    },
    select: { subjectHash: true },
  });
  const allowedHashes = new Set(consents.map((consent) => consent.subjectHash));
  return new Set(
    args.customers
      .filter((customer) => {
        const hash = createHash('sha256').update(customer.phone.toLowerCase().trim()).digest('hex');
        return allowedHashes.has(hash);
      })
      .map((customer) => customer.id),
  );
}
