import { createHmac } from 'node:crypto';
import type { MarketingChannel, PrismaClient } from '@prisma/client';
import { db } from '../../shared/db/client';
import { normalizeCustomerEmail, normalizeCustomerPhone } from '../customers/customer-crm.service';

/**
 * Opt-out register (docs/architecture/proposal-marketing-proof-and-optout-register.md).
 *
 * It keeps only a keyed hash of the address, per restaurant and channel, and is NOT tied to the
 * customer record: erasing a customer must not make a person who objected solicitable again. It is
 * used to exclude, never to send. A plain SHA-256 of an address can be found back by dictionary, hence
 * the HMAC with a server key.
 */

/** Recommended minimum for an opposition list (CNIL); confirmed by the restaurant owner on 2026-10-23. */
export const MARKETING_OPT_OUT_RETENTION_YEARS = 3;

export type MarketingOptOutReason = 'UNSUBSCRIBE' | 'COMPLAINT' | 'MANUAL';

type OptOutWriter = Pick<PrismaClient, 'marketingOptOut'>;

const MIN_SECRET_LENGTH = 32;

export function marketingOptOutSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.MARKETING_OPTOUT_HASH_SECRET?.trim();
  return secret && secret.length >= MIN_SECRET_LENGTH ? secret : null;
}

export function isMarketingOptOutRegisterConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return marketingOptOutSecret(env) !== null;
}

function normalizeAddress(channel: MarketingChannel, address: string): string | null {
  return channel === 'EMAIL' ? normalizeCustomerEmail(address) : normalizeCustomerPhone(address);
}

/**
 * HMAC-SHA256 (hex) of the normalized address. Returns null when the key is missing or the address
 * cannot be normalized: the caller decides whether that blocks a send or only skips a write.
 */
export function marketingOptOutHash(
  channel: MarketingChannel,
  address: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const secret = marketingOptOutSecret(env);
  if (!secret || !address) return null;
  const normalized = normalizeAddress(channel, address);
  if (!normalized) return null;
  return createHmac('sha256', secret).update(`${channel}:${normalized}`).digest('hex');
}

export function marketingOptOutRetainUntil(optedOutAt: Date): Date {
  const retainUntil = new Date(optedOutAt);
  retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + MARKETING_OPT_OUT_RETENTION_YEARS);
  return retainUntil;
}

export type RegisterOptOutResult = 'REGISTERED' | 'SKIPPED_NO_KEY' | 'SKIPPED_NO_ADDRESS';

/** Idempotent: a second opposition refreshes the date and the retention of the same address. */
export async function registerMarketingOptOut(
  input: {
    restaurantId: string;
    channel: MarketingChannel;
    address: string | null | undefined;
    reason: MarketingOptOutReason;
    source: string;
    occurredAt?: Date;
  },
  writer: OptOutWriter = db,
): Promise<RegisterOptOutResult> {
  if (!isMarketingOptOutRegisterConfigured()) return 'SKIPPED_NO_KEY';
  const addressHash = marketingOptOutHash(input.channel, input.address);
  if (!addressHash) return 'SKIPPED_NO_ADDRESS';
  const optedOutAt = input.occurredAt ?? new Date();
  const retainUntil = marketingOptOutRetainUntil(optedOutAt);
  await writer.marketingOptOut.upsert({
    where: {
      restaurantId_channel_addressHash: {
        restaurantId: input.restaurantId,
        channel: input.channel,
        addressHash,
      },
    },
    create: {
      restaurantId: input.restaurantId,
      channel: input.channel,
      addressHash,
      reason: input.reason,
      source: input.source,
      optedOutAt,
      retainUntil,
    },
    update: { reason: input.reason, source: input.source, optedOutAt, retainUntil },
  });
  return 'REGISTERED';
}

/**
 * A new explicit opt-in by the person lifts their earlier opposition. The permission event ledger keeps
 * both acts. A missing key or address changes nothing.
 */
export async function clearMarketingOptOut(
  input: {
    restaurantId: string;
    channel: MarketingChannel;
    address: string | null | undefined;
  },
  writer: OptOutWriter = db,
): Promise<number> {
  const addressHash = marketingOptOutHash(input.channel, input.address);
  if (!addressHash) return 0;
  const result = await writer.marketingOptOut.deleteMany({
    where: { restaurantId: input.restaurantId, channel: input.channel, addressHash },
  });
  return result.count;
}

/**
 * Hashes of the given addresses that appear in the register. The caller must check
 * `isMarketingOptOutRegisterConfigured()` first: without the key nothing can be checked.
 */
export async function findRegisteredOptOutHashes(
  input: { restaurantId: string; channel: MarketingChannel; hashes: string[] },
  reader: OptOutWriter = db,
): Promise<Set<string>> {
  if (input.hashes.length === 0) return new Set();
  const rows = await reader.marketingOptOut.findMany({
    where: {
      restaurantId: input.restaurantId,
      channel: input.channel,
      addressHash: { in: input.hashes },
    },
    select: { addressHash: true },
  });
  return new Set((rows ?? []).map((row) => row.addressHash));
}

export async function isMarketingOptedOut(
  input: { restaurantId: string; channel: MarketingChannel; address: string | null | undefined },
  reader: OptOutWriter = db,
): Promise<boolean> {
  const addressHash = marketingOptOutHash(input.channel, input.address);
  if (!addressHash) return false;
  const found = await findRegisteredOptOutHashes(
    {
      restaurantId: input.restaurantId,
      channel: input.channel,
      hashes: [addressHash],
    },
    reader,
  );
  return found.has(addressHash);
}

/** Deletes the entries whose retention has elapsed. Returns how many were removed. */
export async function purgeExpiredMarketingOptOuts(
  now: Date,
  writer: OptOutWriter = db,
): Promise<number> {
  if (Number.isNaN(now.getTime())) throw new Error('now must be valid');
  const result = await writer.marketingOptOut.deleteMany({
    where: { retainUntil: { lt: now } },
  });
  return result.count;
}

/**
 * Customers among `customers` whose address is in the register for this channel. `checked` is false
 * when the key is missing: nothing could be verified, so a preview must say so and a send must stop.
 */
export async function loadOptedOutCustomerIds(
  input: {
    restaurantId: string;
    channel: MarketingChannel;
    customers: Array<{ id: string; phone?: string | null; emailNormalized?: string | null }>;
  },
  reader: OptOutWriter = db,
): Promise<{ checked: boolean; optedOut: Set<string> }> {
  if (!isMarketingOptOutRegisterConfigured()) return { checked: false, optedOut: new Set() };
  const hashByCustomer = new Map<string, string>();
  for (const customer of input.customers) {
    const address = input.channel === 'EMAIL' ? customer.emailNormalized : customer.phone;
    const hash = marketingOptOutHash(input.channel, address);
    if (hash) hashByCustomer.set(customer.id, hash);
  }
  const registered = await findRegisteredOptOutHashes(
    {
      restaurantId: input.restaurantId,
      channel: input.channel,
      hashes: [...new Set(hashByCustomer.values())],
    },
    reader,
  );
  const optedOut = new Set<string>();
  for (const [customerId, hash] of hashByCustomer) {
    if (registered.has(hash)) optedOut.add(customerId);
  }
  return { checked: true, optedOut };
}
