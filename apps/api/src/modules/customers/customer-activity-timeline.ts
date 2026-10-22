import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';
import { redactPii } from '../voice/stream/pii-redact';
import {
  appendCustomerTimelineEvent,
  buildCustomerTimelineDedupeKey,
  normalizeCustomerEmail,
  normalizeCustomerPhone,
} from './customer-crm.service';
import { findCustomerForPhone } from './customer.service';

/**
 * CRM timeline projections for the event waitlist and gift cards.
 *
 * Every hook here is best effort: the waitlist or gift-card operation has
 * already succeeded when it runs, so a CRM failure is logged (without personal
 * data) and swallowed. Replays are absorbed by the timeline dedupe key.
 *
 * Amounts are recorded in event metadata only. They are not added to the
 * spend metrics: a gift card bought is a prepayment, and a redemption pays
 * part of a bill that the reservation's confirmed revenue already counts.
 */

export type CrmCustomerCandidate = {
  customerId?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type WaitlistTimelineTransition = 'JOINED' | 'PROMOTED' | 'CANCELLED' | 'EXPIRED';

export type WaitlistTimelineEntry = {
  id: string;
  restaurantId: string;
  eventId: string;
  sessionId: string;
  customerId: string | null;
  quantity: number;
};

export type GiftCardPurchaseTimelineCard = {
  id: string;
  restaurantId: string;
  customerId: string | null;
  senderPhone: string | null;
  senderEmail: string | null;
  amount: { toString(): string } | number;
  currency: string;
  createdBy: string;
  packId: string | null;
  purchasedAt: Date;
};

export type GiftCardRedemptionTimelineInput = {
  restaurantId: string;
  giftCardId: string;
  redemptionId: string;
  amount: { toString(): string } | number;
  reservationId?: string | null;
  redeemedAt?: Date;
};

function amountCents(amount: { toString(): string } | number): number {
  return Math.round(Number(amount.toString()) * 100);
}

function warn(error: unknown, context: Record<string, string>, message: string): void {
  logger.warn(
    { err: redactPii(error instanceof Error ? error.message : String(error)), ...context },
    message,
  );
}

async function activeCustomerId(restaurantId: string, customerId: string): Promise<string | null> {
  const customer = await db.customer.findFirst({
    where: { id: customerId, restaurantId, archivedAt: null, mergedIntoId: null },
    select: { id: true },
  });
  return customer?.id ?? null;
}

async function customerIdForEmail(restaurantId: string, email: string): Promise<string | null> {
  const normalizedValue = normalizeCustomerEmail(email);
  if (!normalizedValue) return null;
  const identity = await db.customerIdentity.findUnique({
    where: {
      restaurantId_type_normalizedValue: { restaurantId, type: 'EMAIL', normalizedValue },
    },
    select: { customerId: true },
  });
  return identity ? activeCustomerId(restaurantId, identity.customerId) : null;
}

/**
 * First active customer matching a candidate, in order. Within a candidate the
 * explicit customer id wins, then the normalized phone, then the email. This
 * only matches: it never creates a customer from a gift card or waitlist entry.
 */
export async function resolveCrmCustomerId(
  restaurantId: string,
  candidates: CrmCustomerCandidate[],
): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate.customerId) {
      const id = await activeCustomerId(restaurantId, candidate.customerId);
      if (id) return id;
    }
    if (candidate.phone) {
      const customer = await findCustomerForPhone(
        restaurantId,
        candidate.phone,
        normalizeCustomerPhone(candidate.phone),
      );
      if (customer) return customer.id;
    }
    if (candidate.email) {
      const id = await customerIdForEmail(restaurantId, candidate.email);
      if (id) return id;
    }
  }
  return null;
}

/** Same as resolveCrmCustomerId, but a lookup failure returns null instead of throwing. */
export async function safelyResolveCrmCustomerId(
  restaurantId: string,
  candidates: CrmCustomerCandidate[],
): Promise<string | null> {
  try {
    return await resolveCrmCustomerId(restaurantId, candidates);
  } catch (error) {
    warn(error, { restaurantId }, '[crm] customer lookup failed');
    return null;
  }
}

async function appendEvent(input: {
  restaurantId: string;
  customerId: string;
  eventType: string;
  sourceType: string;
  sourceId: string;
  summaryCode: string;
  occurredAt?: Date;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await appendCustomerTimelineEvent({
    ...input,
    dedupeKey: buildCustomerTimelineDedupeKey(input),
  });
}

/** Timeline row for one waitlist transition of an entry linked to a customer. */
export async function recordWaitlistTimelineEvent(
  entry: WaitlistTimelineEntry,
  transition: WaitlistTimelineTransition,
  occurredAt?: Date,
): Promise<void> {
  if (!entry.customerId) return;
  try {
    const customerId = await resolveCrmCustomerId(entry.restaurantId, [
      { customerId: entry.customerId },
    ]);
    if (!customerId) return;
    await appendEvent({
      restaurantId: entry.restaurantId,
      customerId,
      eventType: `WAITLIST_${transition}`,
      sourceType: 'event_waitlist',
      sourceId: entry.id,
      summaryCode: `waitlist.${transition.toLowerCase()}`,
      occurredAt,
      metadata: { eventId: entry.eventId, sessionId: entry.sessionId, quantity: entry.quantity },
    });
  } catch (error) {
    warn(
      error,
      { restaurantId: entry.restaurantId, waitlistEntryId: entry.id },
      '[crm] waitlist timeline projection failed',
    );
  }
}

/** Timeline row for the buyer of a paid or dashboard-issued gift card. */
export async function recordGiftCardPurchaseTimelineEvent(
  card: GiftCardPurchaseTimelineCard,
): Promise<void> {
  try {
    const customerId = await resolveCrmCustomerId(card.restaurantId, [
      { customerId: card.customerId, phone: card.senderPhone, email: card.senderEmail },
    ]);
    if (!customerId) return;
    await appendEvent({
      restaurantId: card.restaurantId,
      customerId,
      eventType: 'GIFT_CARD_PURCHASED',
      sourceType: 'gift_card',
      sourceId: card.id,
      summaryCode: 'gift_card.purchased',
      occurredAt: card.purchasedAt,
      metadata: {
        amountCents: amountCents(card.amount),
        currency: card.currency,
        channel: card.createdBy,
        pack: card.packId !== null,
      },
    });
  } catch (error) {
    warn(
      error,
      { restaurantId: card.restaurantId, giftCardId: card.id },
      '[crm] gift card purchase timeline projection failed',
    );
  }
}

/**
 * Timeline row for the holder of a redeemed card: the reservation's customer
 * first, then the recipient, the customer linked to the card and the buyer.
 */
export async function recordGiftCardRedemptionTimelineEvent(
  input: GiftCardRedemptionTimelineInput,
): Promise<void> {
  try {
    const card = await db.giftCard.findFirst({
      where: { id: input.giftCardId, restaurantId: input.restaurantId },
      select: {
        customerId: true,
        currency: true,
        recipientPhone: true,
        recipientEmail: true,
        senderPhone: true,
        senderEmail: true,
      },
    });
    if (!card) return;
    const reservation = input.reservationId
      ? await db.reservation.findFirst({
          where: { id: input.reservationId, restaurantId: input.restaurantId },
          select: { customerId: true },
        })
      : null;
    const customerId = await resolveCrmCustomerId(input.restaurantId, [
      { customerId: reservation?.customerId },
      { phone: card.recipientPhone, email: card.recipientEmail },
      { customerId: card.customerId },
      { phone: card.senderPhone, email: card.senderEmail },
    ]);
    if (!customerId) return;
    await appendEvent({
      restaurantId: input.restaurantId,
      customerId,
      eventType: 'GIFT_CARD_REDEEMED',
      sourceType: 'gift_card_redemption',
      sourceId: input.redemptionId,
      summaryCode: 'gift_card.redeemed',
      occurredAt: input.redeemedAt,
      metadata: {
        giftCardId: input.giftCardId,
        amountCents: amountCents(input.amount),
        currency: card.currency,
        ...(input.reservationId ? { reservationId: input.reservationId } : {}),
      },
    });
  } catch (error) {
    warn(
      error,
      { restaurantId: input.restaurantId, giftCardId: input.giftCardId },
      '[crm] gift card redemption timeline projection failed',
    );
  }
}
