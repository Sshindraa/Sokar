import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import '../../../test/helpers.js';
import { db } from '../../../shared/db/client.js';
import { GiftCardBookService } from '../gift-card-book.service.js';
import { GiftCardSlotsService } from '../gift-card-slots.service.js';
import { ReservationService } from '../../agentic-reservations/core/reservation.service.js';

const RESTAURANT_ID = 'rest-gift-1';

function d(value: number) {
  return new Prisma.Decimal(value);
}

const service = new GiftCardBookService(db);

describe('GiftCardBookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('réserve un créneau avec la carte cadeau', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      code: 'abc-1234',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      expiresAt: null,
      preferredPartySize: 2,
      pack: null,
    } as any);
    vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
      maxPartySize: 12,
      minLeadTimeMinutes: 30,
      quoteTtlSeconds: 300,
      holdTtlSeconds: 420,
      noShowPolicy: 'warning',
      requireManualValidation: false,
      capacitySpecials: null,
    } as any);

    vi.spyOn(GiftCardSlotsService.prototype, 'suggestSlots').mockResolvedValue([
      { date: '2026-08-15', time: '19:30' },
      { date: '2026-08-15', time: '20:00' },
      { date: '2026-08-16', time: '19:30' },
    ]);

    vi.spyOn(ReservationService.prototype, 'createReservation').mockResolvedValue({
      reservationId: 'res-1',
      state: 'CONFIRMED',
      reused: false,
      giftCardApplication: {
        reservationId: 'res-1',
        giftCardId: 'gc-1',
        appliedAmount: 100,
        remainingAmount: 0,
        paymentStatus: 'FULLY_COVERED',
        complementAmount: 0,
      },
    });

    const result = await service.book({
      code: 'abc-1234',
      slotIndex: 0,
      customer: { firstName: 'Alice', lastName: 'Dupont', phone: '+33612345678' },
    });

    expect(result.reservationId).toBe('res-1');
    expect(result.giftCardApplication?.paymentStatus).toBe('FULLY_COVERED');
  });

  it('rejette un créneau invalide', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      code: 'abc-1234',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      expiresAt: null,
    } as any);

    vi.spyOn(GiftCardSlotsService.prototype, 'suggestSlots').mockResolvedValue([
      { date: '2026-08-15', time: '19:30' },
    ]);

    await expect(
      service.book({
        code: 'abc-1234',
        slotIndex: 5,
        customer: { firstName: 'Alice', phone: '+33612345678' },
      }),
    ).rejects.toThrow('Créneau invalide');
  });
});
