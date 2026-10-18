import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
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

  describe('créneaux passés (moteur réel)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('ne suggère pas un horaire déjà passé aujourd’hui', async () => {
      // Jeudi 2 juillet 2026, 15:00 à Paris : 12:00 est passé, le premier créneau libre est 15:30.
      vi.restoreAllMocks();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-02T13:00:00.000Z'));
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-2',
        restaurantId: RESTAURANT_ID,
        code: 'abc-5678',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        expiresAt: null,
        preferredPartySize: 2,
        preferredDate: new Date('2026-07-02'),
        pack: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        timezone: 'Europe/Paris',
        openingHours: { thu: { open: '12:00', close: '22:30' } },
        exposureSettings: { capacitySpecials: {} },
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.reservation.findMany).mockResolvedValue([]);
      vi.mocked(db.agenticHold.findMany).mockResolvedValue([]);
      vi.mocked(db.table.findMany).mockResolvedValue([
        { id: 't-1', capacity: 4, minCapacity: 1, sectionId: null },
      ] as unknown as Awaited<ReturnType<typeof db.table.findMany>>);

      const slots = await service.suggestSlots({ giftCardCode: 'abc-5678' });

      expect(slots.slice(0, 3).map((slot) => `${slot.date} ${slot.time}`)).toEqual([
        '2026-07-02 15:30',
        '2026-07-02 16:00',
        '2026-07-02 16:30',
      ]);
    });
  });

  describe('délai minimum du restaurant (affichage)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function suggestWithLead(minLeadTimeMinutes: number) {
      // Jeudi 2 juillet 2026, 15:00 à Paris.
      vi.restoreAllMocks();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-07-02T13:00:00.000Z'));
      vi.mocked(db.giftCard.findUnique).mockResolvedValue({
        id: 'gc-3',
        restaurantId: RESTAURANT_ID,
        code: 'abc-9012',
        amount: d(100),
        remainingAmount: d(100),
        status: 'ACTIVE',
        expiresAt: null,
        preferredPartySize: 2,
        preferredDate: new Date('2026-07-02'),
        pack: null,
      } as unknown as Awaited<ReturnType<typeof db.giftCard.findUnique>>);
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
        minLeadTimeMinutes,
      } as unknown as Awaited<ReturnType<typeof db.restaurantExposureSettings.findUnique>>);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        timezone: 'Europe/Paris',
        openingHours: { thu: { open: '12:00', close: '22:30' } },
        exposureSettings: { capacitySpecials: {} },
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
      vi.mocked(db.reservation.findMany).mockResolvedValue([]);
      vi.mocked(db.agenticHold.findMany).mockResolvedValue([]);
      vi.mocked(db.table.findMany).mockResolvedValue([
        { id: 't-1', capacity: 4, minCapacity: 1, sectionId: null },
      ] as unknown as Awaited<ReturnType<typeof db.table.findMany>>);
      return (await service.suggestSlots({ giftCardCode: 'abc-9012' }))
        .slice(0, 3)
        .map((slot) => slot.time);
    }

    it('ne suggère rien dans le délai : avec 2 h à 15:00, le premier créneau est 17:00', async () => {
      expect(await suggestWithLead(120)).toEqual(['17:00', '17:30', '18:00']);
    });

    it('avec 30 min, le premier créneau est 15:30 (maintenant + 30 min pile)', async () => {
      expect(await suggestWithLead(30)).toEqual(['15:30', '16:00', '16:30']);
    });
  });

  it('retourne une erreur si la carte est invalide', async () => {
    vi.mocked(db.giftCard.findUnique).mockResolvedValue(null);

    await expect(service.suggestSlots({ giftCardCode: 'inexistant' })).rejects.toThrow(
      'Carte cadeau invalide',
    );
  });
});
