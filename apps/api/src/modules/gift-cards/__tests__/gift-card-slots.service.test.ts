import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import '../../../test/helpers.js';
import { db } from '../../../shared/db/client.js';
import { GiftCardSlotsService } from '../gift-card-slots.service.js';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service';

const RESTAURANT_ID = 'rest-gift-1';

function d(value: number) {
  return new Prisma.Decimal(value);
}

const service = new GiftCardSlotsService(db);

describe('GiftCardSlotsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suggère 3 créneaux disponibles', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue({
      id: 'gc-1',
      restaurantId: RESTAURANT_ID,
      code: 'abc-1234',
      amount: d(100),
      remainingAmount: d(100),
      status: 'ACTIVE',
      expiresAt: null,
      preferredPartySize: 2,
      preferredDate: new Date('2026-08-15'),
      pack: null,
    } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);

    vi.spyOn(CapacityAwareAvailabilityService.prototype, 'getAvailability').mockResolvedValue({
      restaurantId: RESTAURANT_ID,
      date: '2026-08-15',
      partySize: 2,
      slots: [
        { time: '19:00', available: true },
        { time: '19:30', available: true },
        { time: '20:00', available: true },
        { time: '20:30', available: false },
      ],
    });

    const slots = await service.suggestSlots({ giftCardCode: 'abc-1234' });

    expect(slots).toHaveLength(3);
    expect(slots[0].time).toBe('19:00');
    expect(slots[0].date).toBe('2026-08-15');
  });

  it('retourne une erreur si la carte est invalide', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue(null);

    await expect(service.suggestSlots({ giftCardCode: 'inexistant' })).rejects.toThrow(
      'Carte cadeau invalide',
    );
  });
});
