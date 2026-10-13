import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const VALEUR_SENSIBLE = 'valeur-de-test-a-ne-jamais-diffuser';

const restaurantRow = {
  id: 'test-rest-1',
  name: 'Le Bistrot',
  managerPhone: '+33612345678',
  managerEmail: 'restaurant@sokar.tech',
  phoneNumber: '+33451221999',
  phoneE164: '+33611112222',
  openingHours: { tue: { open: '12:00', close: '22:00' } },
  googleCalendarId: 'primary',
  googleRefreshToken: VALEUR_SENSIBLE,
  slug: null,
  plan: 'STARTER',
};

type RestaurantRow = Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>;

const OPENING_HOURS = {
  mon: { open: '12:00', close: '22:00' },
  tue: { open: '12:00', close: '22:00' },
  wed: { open: '12:00', close: '22:00' },
  thu: { open: '12:00', close: '22:00' },
  fri: { open: '12:00', close: '22:00' },
  sat: { open: '12:00', close: '22:00' },
  sun: null,
};

describe('fiche restaurant : jeton Google et numéro Sokar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('le jeton Google Agenda ne quitte jamais le serveur', () => {
    it('GET /restaurants/:id renvoie googleCalendarConnected, jamais le jeton', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue(
        restaurantRow as unknown as RestaurantRow,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/test-rest-1',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('googleRefreshToken');
      expect(res.json().googleCalendarConnected).toBe(true);
      expect(res.json().googleCalendarId).toBe('primary');
      expect(res.body).not.toContain(VALEUR_SENSIBLE);
    });

    it('GET /restaurants/:id signale un agenda non relié', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
        ...restaurantRow,
        googleRefreshToken: null,
      } as unknown as RestaurantRow);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/test-rest-1',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().googleCalendarConnected).toBe(false);
      expect(res.json()).not.toHaveProperty('googleRefreshToken');
    });

    it('PATCH /restaurants/:id ne renvoie pas le jeton', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
        phoneNumber: restaurantRow.phoneNumber,
      } as unknown as RestaurantRow);
      vi.mocked(db.restaurant.update).mockResolvedValue(restaurantRow as unknown as RestaurantRow);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Le Bistrot' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('googleRefreshToken');
      expect(res.json().googleCalendarConnected).toBe(true);
      expect(res.body).not.toContain(VALEUR_SENSIBLE);
    });

    it('POST /api/auth/sync ne renvoie pas le jeton du restaurant existant', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        ...restaurantRow,
        accountId: null,
      } as unknown as RestaurantRow);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sync',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().synced).toBe(true);
      expect(res.json().restaurant).not.toHaveProperty('googleRefreshToken');
      expect(res.json().restaurant.googleCalendarConnected).toBe(true);
      expect(res.body).not.toContain(VALEUR_SENSIBLE);
    });
  });

  describe('le numéro Sokar ne se modifie pas depuis la fiche', () => {
    it('PATCH /restaurants/:id ignore un phoneNumber envoyé par le restaurateur', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
        phoneNumber: restaurantRow.phoneNumber,
      } as unknown as RestaurantRow);
      vi.mocked(db.restaurant.update).mockResolvedValue(restaurantRow as unknown as RestaurantRow);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Le Bistrot', phoneNumber: '+33499999999' },
      });

      expect(res.statusCode).toBe(200);
      const call = vi.mocked(db.restaurant.update).mock.calls.at(-1)?.[0];
      expect(call?.data).not.toHaveProperty('phoneNumber');
      expect(call?.data).toEqual(expect.objectContaining({ name: 'Le Bistrot' }));
    });

    it('POST /restaurants est refusé à un restaurateur qui n’est pas opérateur Sokar', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants',
        headers: { authorization: 'Bearer test', 'x-test-not-operator': '1' },
        payload: {
          name: 'Chez Test',
          managerPhone: '+33612345678',
          managerEmail: 'manager@example.com',
          phoneNumber: '+33499999999',
          openingHours: OPENING_HOURS,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(db.restaurant.create).not.toHaveBeenCalled();
    });

    it('POST /restaurants reste possible pour un opérateur, sans renvoyer de jeton', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.create).mockResolvedValue({
        ...restaurantRow,
        googleRefreshToken: null,
      } as unknown as RestaurantRow);

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants',
        headers: { authorization: 'Bearer test' },
        payload: {
          name: 'Chez Test',
          managerPhone: '+33612345678',
          managerEmail: 'manager@example.com',
          phoneNumber: '+33451221999',
          openingHours: OPENING_HOURS,
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).not.toHaveProperty('googleRefreshToken');
      expect(res.json().googleCalendarConnected).toBe(false);
    });
  });
});
