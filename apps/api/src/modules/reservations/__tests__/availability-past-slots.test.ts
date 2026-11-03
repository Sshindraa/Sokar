/**
 * Créneaux passés : la route du widget, le contrat de la voix et la création partagent une seule règle
 * (`isSlotStartPast`) et le même moteur de disponibilités, derrière lequel on n'a mis en doublure que
 * la base. L'horloge est figée : jeudi 2 juillet 2026, 15:00 à Paris (13:00 UTC).
 */

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { redisCache } from '../../../shared/redis/client';
import { ReservationService } from '../reservation.service';
import { isSlotStartPast } from '../../../shared/timezone/restaurant-time';

vi.mock('../../../shared/timezone/restaurant-time', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../shared/timezone/restaurant-time')>();
  return { ...actual, isSlotStartPast: vi.fn(actual.isSlotStartPast) };
});

const NOW = new Date('2026-07-02T13:00:00.000Z'); // 15:00 à Paris
const TODAY = '2026-07-02'; // jeudi, ouvert de 12:00 à 22:30
const TOMORROW = '2026-07-03'; // vendredi, ouvert de 12:00 à 22:30
const CLOSED_DAY = '2026-07-04'; // samedi, fermé

const restaurant = {
  id: 'rest-1',
  name: 'Chez Test',
  timezone: 'Europe/Paris',
  openingHours: {
    thu: { open: '12:00', close: '22:30' },
    fri: { open: '12:00', close: '22:30' },
  },
  exposureSettings: { capacitySpecials: {} },
};

const ROOT_SHAPE = ['allSlots', 'date', 'partySize', 'restaurantId', 'slots'];

function mockDatabase() {
  vi.mocked(db.restaurant.findUnique).mockResolvedValue(
    restaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>,
  );
  vi.mocked(db.reservation.findMany).mockResolvedValue([]);
  vi.mocked(db.agenticHold.findMany).mockResolvedValue([]);
  vi.mocked(db.table.findMany).mockResolvedValue([
    { id: 't-1', capacity: 4, minCapacity: 1, sectionId: null },
  ] as unknown as Awaited<ReturnType<typeof db.table.findMany>>);
  // Sans réglages (délai par défaut de 30 min) ; les tests du délai règlent le leur.
  vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue(null);
}

const withLead = (minLeadTimeMinutes: number) =>
  vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
    minLeadTimeMinutes,
  } as unknown as Awaited<ReturnType<typeof db.restaurantExposureSettings.findUnique>>);

describe('créneaux passés : widget, voix et création', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await redisCache.flushall();
    mockDatabase();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('GET /restaurants/:id/availability (route du widget)', () => {
    const call = async (date: string) => {
      const app = await getApp();
      return app.inject({
        method: 'GET',
        url: `/restaurants/rest-1/availability?date=${date}&partySize=2`,
      });
    };

    it('ne propose plus les horaires déjà passés aujourd’hui', async () => {
      const res = await call(TODAY);

      expect(res.statusCode).toBe(200);
      const body = res.json() as { slots: string[] };
      expect(body.slots).not.toContain('12:00');
      expect(body.slots).not.toContain('14:30');
      expect(body.slots).not.toContain('15:00');
      expect(body.slots).toContain('15:30');
      expect(body.slots).toContain('19:00');
    });

    it('garde la forme de la réponse : les créneaux passés restent dans allSlots, indisponibles', async () => {
      const body = (await call(TODAY)).json() as {
        allSlots: Array<{ time: string; available: boolean }>;
      };

      expect(Object.keys(body).sort()).toEqual(ROOT_SHAPE);
      expect(body.allSlots.find((slot) => slot.time === '12:00')).toEqual({
        time: '12:00',
        available: false,
      });
      expect(body.allSlots.find((slot) => slot.time === '19:00')?.available).toBe(true);
    });

    it('ne change rien demain', async () => {
      const body = (await call(TOMORROW)).json() as { slots: string[] };

      expect(body.slots).toContain('12:00');
      expect(body.slots).toContain('15:00');
      expect(body.slots).toContain('19:00');
    });
  });

  describe('contrat de la voix (ReservationService.availability)', () => {
    it('ne lui donne plus les créneaux passés dans `slots`', async () => {
      const result = await ReservationService.availability('rest-1', TODAY, 2);

      expect(result.slots).not.toContain('12:00');
      expect(result.slots).toContain('19:00');
    });

    it('distingue « complet » de « fermé » : le jour passé a des créneaux, le jour fermé n’en a pas', async () => {
      vi.setSystemTime(new Date('2026-07-02T21:30:00.000Z')); // 23:30 à Paris : plus rien aujourd’hui

      const full = await ReservationService.availability('rest-1', TODAY, 2);
      const closed = await ReservationService.availability('rest-1', CLOSED_DAY, 2);

      // La voix dit « fermé » quand `allSlots` est vide, « complet » quand seul `slots` l'est.
      expect(full.slots).toEqual([]);
      expect(full.allSlots.length).toBeGreaterThan(0);
      expect(full.allSlots.every((slot) => !slot.available)).toBe(true);
      expect(closed.allSlots).toEqual([]);
    });
  });

  describe('checkSlotAvailability (création) : même règle que le moteur', () => {
    type Checker = (
      restaurant: unknown,
      startTime: Date,
      partySize: number,
    ) => Promise<{ available: boolean; reason?: string }>;
    const check = (startTime: Date) =>
      (ReservationService as unknown as { checkSlotAvailability: Checker }).checkSlotAvailability(
        restaurant,
        startTime,
        2,
      );

    it('refuse un créneau qui commence exactement maintenant, par la règle partagée', async () => {
      const result = await check(new Date(NOW));

      expect(result).toEqual({ available: false, reason: 'past' });
      expect(isSlotStartPast).toHaveBeenCalledWith(NOW);
    });

    it('refuse un créneau commencé il y a une milliseconde', async () => {
      const result = await check(new Date(NOW.getTime() - 1));
      expect(result).toEqual({ available: false, reason: 'past' });
    });

    it('ne le refuse pas comme passé une milliseconde après maintenant', async () => {
      const result = await check(new Date(NOW.getTime() + 1));
      expect(result.reason).not.toBe('past');
    });

    it('s’accorde avec le moteur à la milliseconde près', async () => {
      // Le créneau de 15:30 à Paris commence 30 minutes après NOW.
      const slotStart = new Date('2026-07-02T13:30:00.000Z');
      const engineSays = async (now: Date) => {
        await redisCache.flushall();
        vi.setSystemTime(now);
        const dto = await ReservationService.availability('rest-1', TODAY, 2);
        return dto.slots.includes('15:30');
      };

      expect(await engineSays(new Date(slotStart.getTime() - 1))).toBe(true);
      expect(await engineSays(new Date(slotStart.getTime()))).toBe(false);

      vi.setSystemTime(new Date(slotStart.getTime() - 1));
      expect((await check(slotStart)).reason).not.toBe('past');
      vi.setSystemTime(new Date(slotStart.getTime()));
      expect(await check(slotStart)).toEqual({ available: false, reason: 'past' });
    });
  });

  describe('délai minimum : la page /book est en ligne, la voix ne l’est pas', () => {
    const slotsOf = async (date = TODAY) => {
      const app = await getApp();
      const res = await app.inject({
        method: 'GET',
        url: `/restaurants/rest-1/availability?date=${date}&partySize=2`,
      });
      return (res.json() as { slots: string[] }).slots;
    };

    it('page /book : avec 2 h à 15:00, rien avant 17:00, et 17:00 est proposé', async () => {
      withLead(120);

      const slots = await slotsOf();

      expect(slots).not.toContain('15:30');
      expect(slots).not.toContain('16:30');
      expect(slots).toContain('17:00');
      expect(slots).toContain('19:00');
    });

    it('page /book : demain, rien ne change', async () => {
      withLead(120);

      const slots = await slotsOf(TOMORROW);

      expect(slots).toContain('12:00');
      expect(slots).toContain('15:00');
    });

    it('voix : le même restaurant à 2 h propose toujours 15:30 et 16:00 au téléphone', async () => {
      withLead(120);

      // La voix appelle le service sans délai : seul le passé est indisponible.
      const result = await ReservationService.availability('rest-1', TODAY, 2);

      expect(result.slots).toContain('15:30');
      expect(result.slots).toContain('16:00');
      expect(result.slots).not.toContain('15:00'); // commence exactement maintenant : passé
    });

    it('voix : le service ne lit jamais le délai du restaurant', async () => {
      withLead(120);

      await ReservationService.availability('rest-1', TODAY, 2);

      expect(db.restaurantExposureSettings.findUnique).not.toHaveBeenCalled();
    });
  });
});
