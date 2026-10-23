import { MarketingPermissionStatus, type MarketingPermission } from '@prisma/client';
import {
  buildMarketingConsentProof,
  MARKETING_CONSENT_VERSION,
  type MarketingConsentChannel,
  type MarketingConsentCollectionMethod,
} from '@sokar/shared';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import { normalizeCustomerEmail, upsertCustomerIdentity } from '../customers/customer-crm.service';
import { upsertMarketingPermission } from './marketing-permission.service';

/** Where a consent tick came from. Stored as `MarketingPermission.source`. */
export type BookingConsentSource = 'CONNECT' | 'BOOK_PAGE' | 'WIDGET';

/** Optional block added to the public booking requests. Unticked or absent means "not asked". */
export type BookingMarketingConsent = {
  email?: boolean;
  sms?: boolean;
  version: string;
};

export type BookingConsentOutcome =
  | 'RECORDED'
  | 'ALREADY_GRANTED'
  | 'NOT_REQUESTED'
  | 'VERSION_MISMATCH'
  | 'EMAIL_REQUIRED'
  | 'EMAIL_MISMATCH'
  | 'FAILED';

export type BookingConsentResult = Record<MarketingConsentChannel, BookingConsentOutcome>;

/**
 * The address a customer ticks the box for must be the address the campaign will reach. A public
 * booking form never overwrites an email already on file, and never takes one from another customer.
 */
async function attachBookingEmail(args: {
  restaurantId: string;
  customerId: string;
  email: string | null | undefined;
}): Promise<'OK' | 'EMAIL_REQUIRED' | 'EMAIL_MISMATCH'> {
  const normalized = args.email ? normalizeCustomerEmail(args.email) : null;
  if (!normalized) return 'EMAIL_REQUIRED';

  const customer = await db.customer.findFirst({
    where: { id: args.customerId, restaurantId: args.restaurantId, archivedAt: null },
    select: { emailNormalized: true },
  });
  if (!customer) return 'EMAIL_REQUIRED';
  if (customer.emailNormalized) {
    return customer.emailNormalized === normalized ? 'OK' : 'EMAIL_MISMATCH';
  }

  const identity = await upsertCustomerIdentity({
    restaurantId: args.restaurantId,
    customerId: args.customerId,
    type: 'EMAIL',
    value: args.email!,
    source: 'BOOKING_CONSENT',
  });
  if (identity.status === 'conflict') return 'EMAIL_MISMATCH';

  const updated = await db.customer.updateMany({
    where: { id: args.customerId, restaurantId: args.restaurantId, emailNormalized: null },
    data: { emailNormalized: normalized },
  });
  if (updated.count === 1) return 'OK';

  const raced = await db.customer.findFirst({
    where: { id: args.customerId, restaurantId: args.restaurantId },
    select: { emailNormalized: true },
  });
  return raced?.emailNormalized === normalized ? 'OK' : 'EMAIL_MISMATCH';
}

async function grantChannel(args: {
  restaurantId: string;
  customerId: string;
  restaurantName: string;
  channel: MarketingConsentChannel;
  source: BookingConsentSource;
  occurredAt: Date;
}): Promise<'RECORDED' | 'ALREADY_GRANTED'> {
  const existing = await db.marketingPermission.findFirst({
    where: {
      restaurantId: args.restaurantId,
      customerId: args.customerId,
      channel: args.channel,
    },
    select: { status: true, proofVersion: true },
  });
  if (
    existing?.status === MarketingPermissionStatus.OPTED_IN &&
    existing.proofVersion === MARKETING_CONSENT_VERSION
  ) {
    return 'ALREADY_GRANTED';
  }
  await upsertMarketingPermission({
    restaurantId: args.restaurantId,
    customerId: args.customerId,
    channel: args.channel,
    status: MarketingPermissionStatus.OPTED_IN,
    source: args.source,
    proofVersion: MARKETING_CONSENT_VERSION,
    proof: buildMarketingConsentProof(args.channel, args.restaurantName),
    occurredAt: args.occurredAt,
  });
  return 'RECORDED';
}

/**
 * Records the optional marketing ticks of a public booking form. It is a best-effort side effect of
 * a reservation: it never throws and never blocks the booking, and an unticked box changes nothing
 * (a previous opt-in or withdrawal stays as it is). No address, phone number or name is logged.
 */
export async function recordBookingMarketingConsent(args: {
  restaurantId: string;
  restaurantName: string;
  customerId: string | null;
  source: BookingConsentSource;
  consent: BookingMarketingConsent | undefined;
  email?: string | null;
  occurredAt?: Date;
}): Promise<BookingConsentResult> {
  const result: BookingConsentResult = { EMAIL: 'NOT_REQUESTED', SMS: 'NOT_REQUESTED' };
  const requested: MarketingConsentChannel[] = [];
  if (args.consent?.email === true) requested.push('EMAIL');
  if (args.consent?.sms === true) requested.push('SMS');
  if (requested.length === 0) return result;

  if (args.consent?.version !== MARKETING_CONSENT_VERSION) {
    // An outdated page showed other wording: nothing is recorded rather than a proof that
    // would not match what the customer read.
    for (const channel of requested) result[channel] = 'VERSION_MISMATCH';
    logger.warn(
      { restaurantId: args.restaurantId, source: args.source },
      '[marketing-consent] unknown wording version',
    );
    return result;
  }
  if (!args.customerId) {
    for (const channel of requested) result[channel] = 'FAILED';
    return result;
  }

  const occurredAt = args.occurredAt ?? new Date();
  for (const channel of requested) {
    try {
      if (channel === 'EMAIL') {
        const attached = await attachBookingEmail({
          restaurantId: args.restaurantId,
          customerId: args.customerId,
          email: args.email,
        });
        if (attached !== 'OK') {
          result.EMAIL = attached;
          continue;
        }
      }
      result[channel] = await grantChannel({
        restaurantId: args.restaurantId,
        customerId: args.customerId,
        restaurantName: args.restaurantName,
        channel,
        source: args.source,
        occurredAt,
      });
    } catch (error) {
      result[channel] = 'FAILED';
      logger.warn(
        {
          restaurantId: args.restaurantId,
          channel,
          source: args.source,
          err: error instanceof Error ? error.name : 'unknown',
        },
        '[marketing-consent] booking consent not recorded',
      );
    }
  }
  return result;
}

/**
 * Consent collected by the restaurant team outside a form (at the table, by phone, on paper). The
 * team picks how it was obtained; the stored proof is rebuilt here from the versioned wording plus
 * that method, never taken from the client.
 */
export async function recordStaffMarketingConsent(args: {
  restaurantId: string;
  customerId: string;
  channel: MarketingConsentChannel;
  method: MarketingConsentCollectionMethod;
  /** The team member who recorded the agreement, kept with the proof. */
  actorUserId?: string | null;
  occurredAt?: Date;
}): Promise<MarketingPermission> {
  const customer = await db.customer.findFirst({
    where: { id: args.customerId, restaurantId: args.restaurantId, archivedAt: null },
    select: { emailNormalized: true },
  });
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
  if (args.channel === 'EMAIL' && !customer.emailNormalized) {
    throw new Error('CUSTOMER_EMAIL_REQUIRED');
  }
  const restaurant = await db.restaurant.findUnique({
    where: { id: args.restaurantId },
    select: { name: true },
  });
  if (!restaurant) throw new Error('RESTAURANT_NOT_FOUND');

  return upsertMarketingPermission({
    restaurantId: args.restaurantId,
    customerId: args.customerId,
    channel: args.channel,
    status: MarketingPermissionStatus.OPTED_IN,
    source: `DASHBOARD_${args.method}`,
    proofVersion: MARKETING_CONSENT_VERSION,
    proof: `${buildMarketingConsentProof(args.channel, restaurant.name)}|${args.method}`,
    actorUserId: args.actorUserId,
    occurredAt: args.occurredAt,
  });
}
