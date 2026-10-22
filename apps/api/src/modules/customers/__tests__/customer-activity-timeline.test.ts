import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  recordGiftCardPurchaseTimelineEvent,
  recordGiftCardRedemptionTimelineEvent,
  recordWaitlistTimelineEvent,
  resolveCrmCustomerId,
} from '../customer-activity-timeline';

const RESTAURANT_ID = 'restaurant-1';
const NOW = new Date('2026-10-22T10:00:00.000Z');

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { findFirst: vi.fn(), findUnique: vi.fn() },
    customerIdentity: { findUnique: vi.fn() },
    customerTimelineEvent: { create: vi.fn(), findUnique: vi.fn() },
    giftCard: { findFirst: vi.fn() },
    reservation: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../shared/logger/pino', () => ({ logger: { warn: vi.fn() } }));

function activeCustomers(...ids: string[]) {
  vi.mocked(db.customer.findFirst).mockImplementation((async (args: {
    where: { id: string; restaurantId: string };
  }) =>
    ids.includes(args.where.id) && args.where.restaurantId === RESTAURANT_ID
      ? { id: args.where.id }
      : null) as never);
  vi.mocked(db.customer.findUnique).mockResolvedValue({ restaurantId: RESTAURANT_ID } as never);
}

function phoneIdentities(byPhone: Record<string, string>) {
  vi.mocked(db.customerIdentity.findUnique).mockImplementation((async (args: {
    where: { restaurantId_type_normalizedValue: { type: string; normalizedValue: string } };
  }) => {
    const key = args.where.restaurantId_type_normalizedValue;
    const customerId = byPhone[key.normalizedValue];
    if (!customerId) return null;
    return key.type === 'PHONE'
      ? {
          customer: {
            id: customerId,
            restaurantId: RESTAURANT_ID,
            archivedAt: null,
            mergedIntoId: null,
          },
        }
      : { customerId };
  }) as never);
}

function createdEvents() {
  return vi.mocked(db.customerTimelineEvent.create).mock.calls.map((call) => call[0].data);
}

const waitlistEntry = {
  id: 'waitlist-1',
  restaurantId: RESTAURANT_ID,
  eventId: 'event-1',
  sessionId: 'session-1',
  customerId: 'customer-1',
  quantity: 2,
};

describe('customer activity timeline', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(db.customerTimelineEvent.create).mockImplementation(
      (async (args: { data: unknown }) => args.data) as never,
    );
  });

  it('matches a customer by normalized phone, then by email, without creating one', async () => {
    activeCustomers('customer-email');
    phoneIdentities({ '+33612345678': 'customer-phone', 'ami@example.fr': 'customer-email' });

    await expect(
      resolveCrmCustomerId(RESTAURANT_ID, [{ phone: '+33 6 12 34 56 78' }]),
    ).resolves.toBe('customer-phone');
    await expect(
      resolveCrmCustomerId(RESTAURANT_ID, [
        { phone: '+33 7 00 00 00 00', email: 'Ami@Example.fr' },
      ]),
    ).resolves.toBe('customer-email');
  });

  it('appends one deduplicated waitlist event per transition', async () => {
    activeCustomers('customer-1');

    await recordWaitlistTimelineEvent(waitlistEntry, 'JOINED', NOW);
    await recordWaitlistTimelineEvent(waitlistEntry, 'EXPIRED', NOW);

    const [joined, expired] = createdEvents();
    expect(joined).toMatchObject({
      restaurantId: RESTAURANT_ID,
      customerId: 'customer-1',
      eventType: 'WAITLIST_JOINED',
      sourceType: 'event_waitlist',
      sourceId: 'waitlist-1',
      summaryCode: 'waitlist.joined',
      dedupeKey: `crm:${RESTAURANT_ID}:customer-1:WAITLIST_JOINED:event_waitlist:waitlist-1`,
      metadata: { eventId: 'event-1', sessionId: 'session-1', quantity: 2 },
    });
    expect(expired).toMatchObject({ summaryCode: 'waitlist.expired' });
    expect(expired.dedupeKey).not.toBe(joined.dedupeKey);
  });

  it('skips entries without a customer and archived or foreign customers', async () => {
    activeCustomers();

    await recordWaitlistTimelineEvent({ ...waitlistEntry, customerId: null }, 'JOINED');
    await recordWaitlistTimelineEvent(waitlistEntry, 'JOINED');

    expect(db.customerTimelineEvent.create).not.toHaveBeenCalled();
  });

  it('treats a replayed timeline write as already recorded', async () => {
    activeCustomers('customer-1');
    vi.mocked(db.customerTimelineEvent.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    vi.mocked(db.customerTimelineEvent.findUnique).mockResolvedValue({ id: 'existing' } as never);

    await expect(recordWaitlistTimelineEvent(waitlistEntry, 'CANCELLED')).resolves.toBeUndefined();
  });

  it('never throws when the CRM write fails', async () => {
    activeCustomers('customer-1');
    vi.mocked(db.customerTimelineEvent.create).mockRejectedValue(new Error('db down +33612345678'));
    const { logger } = await import('../../../shared/logger/pino');

    await expect(recordWaitlistTimelineEvent(waitlistEntry, 'PROMOTED')).resolves.toBeUndefined();
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain('612345678');
  });

  it('records a gift card purchase for the buyer known by phone, amount in metadata only', async () => {
    activeCustomers();
    phoneIdentities({ '+33612345678': 'customer-buyer' });

    await recordGiftCardPurchaseTimelineEvent({
      id: 'gift-1',
      restaurantId: RESTAURANT_ID,
      customerId: null,
      senderPhone: '+33612345678',
      senderEmail: 'buyer@example.fr',
      amount: new Prisma.Decimal('75.50'),
      currency: 'EUR',
      createdBy: 'CLIENT',
      packId: null,
      purchasedAt: NOW,
    });

    expect(createdEvents()).toEqual([
      expect.objectContaining({
        customerId: 'customer-buyer',
        eventType: 'GIFT_CARD_PURCHASED',
        sourceType: 'gift_card',
        sourceId: 'gift-1',
        summaryCode: 'gift_card.purchased',
        occurredAt: NOW,
        metadata: { amountCents: 7550, currency: 'EUR', channel: 'CLIENT', pack: false },
      }),
    ]);
  });

  it('attributes a redemption to the reservation customer before the recipient', async () => {
    activeCustomers('customer-guest');
    phoneIdentities({ '+33699999999': 'customer-recipient' });
    vi.mocked(db.giftCard.findFirst).mockResolvedValue({
      customerId: null,
      currency: 'EUR',
      recipientPhone: '+33699999999',
      recipientEmail: null,
      senderPhone: null,
      senderEmail: null,
    } as never);
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      customerId: 'customer-guest',
    } as never);

    await recordGiftCardRedemptionTimelineEvent({
      restaurantId: RESTAURANT_ID,
      giftCardId: 'gift-1',
      redemptionId: 'redemption-1',
      amount: 40,
      reservationId: 'reservation-1',
      redeemedAt: NOW,
    });

    expect(createdEvents()).toEqual([
      expect.objectContaining({
        customerId: 'customer-guest',
        eventType: 'GIFT_CARD_REDEEMED',
        sourceId: 'redemption-1',
        metadata: {
          giftCardId: 'gift-1',
          amountCents: 4000,
          currency: 'EUR',
          reservationId: 'reservation-1',
        },
      }),
    ]);
  });

  it('falls back to the recipient phone when the redemption has no reservation', async () => {
    activeCustomers();
    phoneIdentities({ '+33699999999': 'customer-recipient' });
    vi.mocked(db.giftCard.findFirst).mockResolvedValue({
      customerId: null,
      currency: 'EUR',
      recipientPhone: '+33699999999',
      recipientEmail: null,
      senderPhone: '+33611111111',
      senderEmail: null,
    } as never);

    await recordGiftCardRedemptionTimelineEvent({
      restaurantId: RESTAURANT_ID,
      giftCardId: 'gift-1',
      redemptionId: 'redemption-2',
      amount: 10,
    });

    expect(db.reservation.findFirst).not.toHaveBeenCalled();
    expect(createdEvents()).toEqual([
      expect.objectContaining({ customerId: 'customer-recipient' }),
    ]);
  });
});
