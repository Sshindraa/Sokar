import { createHmac, timingSafeEqual } from 'node:crypto';
import { MarketingChannel, type MarketingPermission } from '@prisma/client';
import { db } from '../../shared/db/client';
import {
  MARKETING_CHANNELS,
  withdrawMarketingPermission,
  type MarketingChannelCode,
} from './marketing-permission.service';

const TOKEN_VERSION = 'v1';
const DEFAULT_UNSUBSCRIBE_TTL_DAYS = 365;
const MAX_UNSUBSCRIBE_TTL_DAYS = 730;

type UnsubscribeTokenPayload = {
  v: 1;
  restaurantId: string;
  customerId: string;
  channel: MarketingChannelCode;
  exp: number;
};

function getSecret(): string {
  // Keep the unsubscribe token secret separate in production. The attribution
  // secret is accepted as a local/staging fallback so a rollout does not fail
  // solely because a second secret has not yet been provisioned.
  const secret =
    process.env.MARKETING_UNSUBSCRIBE_SECRET?.trim() ||
    process.env.MARKETING_ATTRIBUTION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('MARKETING_UNSUBSCRIBE_SECRET_NOT_CONFIGURED');
  }
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function sign(value: string): string {
  return createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function validDate(value: Date | undefined, field: string): Date {
  const result = value ?? new Date();
  if (Number.isNaN(result.getTime())) throw new Error(`${field} must be a valid date`);
  return result;
}

function normalizeChannel(value: MarketingChannelCode): MarketingChannel {
  if (!MARKETING_CHANNELS.includes(value)) throw new Error('unsupported marketing channel');
  return value as MarketingChannel;
}

function parseToken(token: string, now = new Date()): UnsubscribeTokenPayload {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    throw new Error('INVALID_UNSUBSCRIBE_TOKEN');
  }
  const payloadEncoded = parts[1];
  const actual = Buffer.from(parts[2]);
  const expected = Buffer.from(sign(`${TOKEN_VERSION}.${payloadEncoded}`));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error('INVALID_UNSUBSCRIBE_TOKEN');
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(decode(payloadEncoded));
  } catch {
    throw new Error('INVALID_UNSUBSCRIBE_TOKEN');
  }
  if (!decoded || typeof decoded !== 'object') throw new Error('INVALID_UNSUBSCRIBE_TOKEN');
  const candidate = decoded as Record<string, unknown>;
  if (
    candidate.v !== 1 ||
    typeof candidate.restaurantId !== 'string' ||
    typeof candidate.customerId !== 'string' ||
    typeof candidate.channel !== 'string' ||
    !MARKETING_CHANNELS.includes(candidate.channel as MarketingChannelCode) ||
    typeof candidate.exp !== 'number' ||
    !Number.isInteger(candidate.exp)
  ) {
    throw new Error('INVALID_UNSUBSCRIBE_TOKEN');
  }
  if (candidate.exp <= Math.floor(now.getTime() / 1000)) {
    throw new Error('UNSUBSCRIBE_TOKEN_EXPIRED');
  }
  return candidate as UnsubscribeTokenPayload;
}

export function defaultUnsubscribeExpiry(issuedAt = new Date()): Date {
  const result = new Date(issuedAt);
  result.setDate(result.getDate() + DEFAULT_UNSUBSCRIBE_TTL_DAYS);
  return result;
}

export async function createMarketingUnsubscribeToken(args: {
  restaurantId: string;
  customerId: string;
  channel: MarketingChannelCode;
  issuedAt?: Date;
  expiresAt?: Date;
}): Promise<string> {
  const issuedAt = validDate(args.issuedAt, 'issuedAt');
  const expiresAt = args.expiresAt
    ? validDate(args.expiresAt, 'expiresAt')
    : defaultUnsubscribeExpiry(issuedAt);
  const maxExpiry = issuedAt.getTime() + MAX_UNSUBSCRIBE_TTL_DAYS * 86_400_000;
  if (expiresAt <= issuedAt || expiresAt.getTime() > maxExpiry) {
    throw new Error(
      `unsubscribe token expiry must be between 1 and ${MAX_UNSUBSCRIBE_TTL_DAYS} days`,
    );
  }
  const channel = normalizeChannel(args.channel);
  const customer = await db.customer.findFirst({
    where: { id: args.customerId, restaurantId: args.restaurantId, archivedAt: null },
    select: { id: true },
  });
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const payload: UnsubscribeTokenPayload = {
    v: 1,
    restaurantId: args.restaurantId,
    customerId: args.customerId,
    channel,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const encoded = encode(JSON.stringify(payload));
  return `${TOKEN_VERSION}.${encoded}.${sign(`${TOKEN_VERSION}.${encoded}`)}`;
}

export function buildMarketingUnsubscribeUrl(token: string): string {
  const base =
    process.env.MARKETING_UNSUBSCRIBE_BASE_URL?.trim() ||
    `${process.env.API_URL?.trim() || 'https://api.sokar.tech'}/marketing/unsubscribe`;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('MARKETING_UNSUBSCRIBE_BASE_URL must be an absolute URL');
  }
  url.searchParams.set('token', token);
  return url.toString();
}

export async function consumeMarketingUnsubscribeToken(args: {
  token: string;
  now?: Date;
}): Promise<{
  customerId: string;
  restaurantId: string;
  channel: MarketingChannel;
  permission: MarketingPermission;
}> {
  const now = validDate(args.now, 'now');
  const payload = parseToken(args.token, now);
  const permission = await withdrawMarketingPermission({
    restaurantId: payload.restaurantId,
    customerId: payload.customerId,
    channel: payload.channel,
    source: 'UNSUBSCRIBE_LINK',
    occurredAt: now,
  });
  return {
    customerId: payload.customerId,
    restaurantId: payload.restaurantId,
    channel: payload.channel as MarketingChannel,
    permission,
  };
}
