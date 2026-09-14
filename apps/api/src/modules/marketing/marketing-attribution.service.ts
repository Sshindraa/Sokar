import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { MarketingConversionType, Prisma, type MarketingAttributionLink } from '@prisma/client';
import { db } from '../../shared/db/client';

const TOKEN_VERSION = 'v1';
const DEFAULT_LINK_TTL_DAYS = 30;
const MAX_LINK_TTL_DAYS = 90;

type AttributionTokenPayload = {
  v: 1;
  id: string;
  restaurantId: string;
  campaignId: string;
  exp: number;
};

export type MarketingConversionInput = {
  restaurantId: string;
  campaignId: string;
  customerId: string;
  reservationId?: string | null;
  conversionType: MarketingConversionType;
  attributedAt?: Date;
  windowEndsAt?: Date | null;
};

function getSecret(): string {
  const secret = process.env.MARKETING_ATTRIBUTION_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error('ATTRIBUTION_SECRET_NOT_CONFIGURED');
  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signPayload(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function validDate(value: Date | undefined, field = 'date'): Date {
  const result = value ?? new Date();
  if (Number.isNaN(result.getTime())) throw new Error(`${field} must be a valid date`);
  return result;
}

function parseToken(token: string, now = new Date()): AttributionTokenPayload {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION)
    throw new Error('INVALID_ATTRIBUTION_TOKEN');
  const payloadEncoded = parts[1];
  const signature = parts[2];
  const expected = signPayload(`${TOKEN_VERSION}.${payloadEncoded}`);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error('INVALID_ATTRIBUTION_TOKEN');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(decode(payloadEncoded));
  } catch {
    throw new Error('INVALID_ATTRIBUTION_TOKEN');
  }
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_ATTRIBUTION_TOKEN');
  const candidate = payload as Record<string, unknown>;
  if (
    candidate.v !== 1 ||
    typeof candidate.id !== 'string' ||
    typeof candidate.restaurantId !== 'string' ||
    typeof candidate.campaignId !== 'string' ||
    typeof candidate.exp !== 'number' ||
    !Number.isInteger(candidate.exp)
  ) {
    throw new Error('INVALID_ATTRIBUTION_TOKEN');
  }
  if (candidate.exp <= Math.floor(now.getTime() / 1000)) {
    throw new Error('ATTRIBUTION_TOKEN_EXPIRED');
  }
  return candidate as AttributionTokenPayload;
}

export async function createMarketingAttributionLink(args: {
  restaurantId: string;
  campaignId: string;
  customerId: string;
  issuedAt?: Date;
  expiresAt?: Date;
}): Promise<{ link: MarketingAttributionLink; token: string }> {
  const issuedAt = validDate(args.issuedAt);
  const expiresAt = args.expiresAt
    ? validDate(args.expiresAt, 'expiresAt')
    : defaultAttributionExpiry(issuedAt);
  const maxExpiry = issuedAt.getTime() + MAX_LINK_TTL_DAYS * 86_400_000;
  if (expiresAt <= issuedAt || expiresAt.getTime() > maxExpiry) {
    throw new Error(`attribution link expiry must be between 1 and ${MAX_LINK_TTL_DAYS} days`);
  }
  const campaign = await db.marketingCampaign.findFirst({
    where: { id: args.campaignId, restaurantId: args.restaurantId },
    select: { id: true },
  });
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const customer = await db.customer.findFirst({
    where: { id: args.customerId, restaurantId: args.restaurantId, archivedAt: null },
    select: { id: true },
  });
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const id = randomUUID();
  const payload: AttributionTokenPayload = {
    v: 1,
    id,
    restaurantId: args.restaurantId,
    campaignId: args.campaignId,
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const encodedPayload = encode(JSON.stringify(payload));
  const token = `${TOKEN_VERSION}.${encodedPayload}.${signPayload(`${TOKEN_VERSION}.${encodedPayload}`)}`;
  const tokenHash = hashToken(token);
  const link = await db.marketingAttributionLink.upsert({
    where: { campaignId_customerId: { campaignId: args.campaignId, customerId: args.customerId } },
    create: {
      id,
      restaurantId: args.restaurantId,
      campaignId: args.campaignId,
      customerId: args.customerId,
      tokenHash,
      issuedAt,
      expiresAt,
    },
    update: {
      id,
      restaurantId: args.restaurantId,
      tokenHash,
      issuedAt,
      expiresAt,
      clickedAt: null,
    },
  });
  return { link, token };
}

export async function recordMarketingAttributionClick(args: {
  token: string;
  now?: Date;
}): Promise<MarketingAttributionLink | null> {
  const now = validDate(args.now);
  let payload: AttributionTokenPayload;
  try {
    payload = parseToken(args.token, now);
  } catch (error) {
    if (error instanceof Error && error.message === 'ATTRIBUTION_TOKEN_EXPIRED') return null;
    throw error;
  }
  const link = await db.marketingAttributionLink.findFirst({
    where: {
      id: payload.id,
      restaurantId: payload.restaurantId,
      campaignId: payload.campaignId,
      tokenHash: hashToken(args.token),
      expiresAt: { gt: now },
    },
  });
  if (!link) return null;
  if (!link.clickedAt) {
    return db.marketingAttributionLink.update({
      where: { id: link.id },
      data: { clickedAt: now },
    });
  }
  return link;
}

export async function recordMarketingConversion(
  input: MarketingConversionInput,
): Promise<{ conversion: unknown; created: boolean }> {
  const attributedAt = validDate(input.attributedAt, 'attributedAt');
  const windowEndsAt = input.windowEndsAt === undefined ? null : input.windowEndsAt;
  if (windowEndsAt && Number.isNaN(windowEndsAt.getTime())) {
    throw new Error('windowEndsAt must be a valid date');
  }
  const campaign = await db.marketingCampaign.findFirst({
    where: { id: input.campaignId, restaurantId: input.restaurantId },
    select: { id: true },
  });
  if (!campaign) throw new Error('CAMPAIGN_NOT_FOUND');
  const customer = await db.customer.findFirst({
    where: { id: input.customerId, restaurantId: input.restaurantId, archivedAt: null },
    select: { id: true },
  });
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const conversionKey = [
    input.campaignId,
    input.customerId,
    input.reservationId ?? 'none',
    input.conversionType,
  ].join(':');
  try {
    const conversion = await db.$transaction(async (tx) => {
      const created = await tx.marketingConversion.create({
        data: {
          campaignId: input.campaignId,
          customerId: input.customerId,
          reservationId: input.reservationId ?? null,
          conversionType: input.conversionType,
          conversionKey,
          attributedAt,
          windowEndsAt,
        },
      });
      await tx.marketingCampaign.update({
        where: { id: input.campaignId },
        data: { conversionCount: { increment: 1 } },
      });
      return created;
    });
    return { conversion, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const existing = await db.marketingConversion.findUnique({
      where: { conversionKey },
    });
    if (!existing) throw error;
    return { conversion: existing, created: false };
  }
}

export async function deactivateMarketingConversions(args: {
  restaurantId: string;
  reservationId: string;
}): Promise<number> {
  const result = await db.marketingConversion.updateMany({
    where: {
      reservationId: args.reservationId,
      active: true,
      campaign: { restaurantId: args.restaurantId },
    },
    data: { active: false },
  });
  return result.count;
}

/**
 * Promotes active reservation-created conversions to a visit conversion.
 *
 * The reservation state machine can be replayed by a dashboard retry, so the
 * unique conversion key in `recordMarketingConversion` is the idempotency
 * boundary. Only active `RESERVATION_CREATED` rows are eligible; cancelled or
 * manually deactivated reservations must never be counted as honored revenue.
 */
export async function recordMarketingHonoredConversions(args: {
  restaurantId: string;
  reservationId: string;
  customerId?: string | null;
  honoredAt?: Date;
}): Promise<number> {
  if (!args.customerId) return 0;
  const honoredAt = validDate(args.honoredAt, 'honoredAt');
  const created = await db.marketingConversion.findMany({
    where: {
      reservationId: args.reservationId,
      customerId: args.customerId,
      conversionType: MarketingConversionType.RESERVATION_CREATED,
      active: true,
      campaign: { restaurantId: args.restaurantId },
    },
    select: { campaignId: true, windowEndsAt: true },
  });
  let count = 0;
  for (const conversion of created) {
    const result = await recordMarketingConversion({
      restaurantId: args.restaurantId,
      campaignId: conversion.campaignId,
      customerId: args.customerId,
      reservationId: args.reservationId,
      conversionType: MarketingConversionType.RESERVATION_HONORED,
      attributedAt: honoredAt,
      windowEndsAt: conversion.windowEndsAt,
    });
    if (result.created) count++;
  }
  return count;
}

export function defaultAttributionExpiry(issuedAt = new Date()): Date {
  const result = new Date(issuedAt);
  result.setDate(result.getDate() + DEFAULT_LINK_TTL_DAYS);
  return result;
}
