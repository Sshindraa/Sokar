/**
 * Route-level tests for reservationRoutes.
 *
 * Pattern: Fastify `inject()` against `getApp()` (shared helper that
 * mounts the full app with requireOrg mocked to require an Authorization
 * header). The helper mocks db, queues, google calendar, and Clerk so
 * we exercise the real Fastify+Zod+route pipeline end-to-end without
 * external services.
 *
 * Scope: 5 endpoints (GET /reservations, GET /availability, POST, PATCH,
 * DELETE). Each test asserts both happy path and the surface bugs/latency
 * issues that the routes expose.
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { ReservationService, RESERVATION_REPLAY_SCOPE_MISMATCH } from '../reservation.service';

describe('reservation.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('GET /reservations', () => {
    it('retourne les réservations du restaurant authentifié', async () => {
      const app = await getApp();
      const reservations = [
        { id: 'r1', restaurantId: 'test-rest-1', reservedAt: new Date('2099-06-05T19:00:00') },
        { id: 'r2', restaurantId: 'test-rest-1', reservedAt: new Date('2099-06-05T20:00:00') },
      ];
      vi.spyOn(ReservationService, 'findByRestaurant').mockResolvedValue(
        reservations as unknown as Awaited<ReturnType<typeof ReservationService.findByRestaurant>>,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/reservations?date=2099-06-05',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.findByRestaurant).toHaveBeenCalledWith('test-rest-1', '2099-06-05');
      const body = res.json();
      expect(body).toHaveLength(2);
      expect(body[0].id).toBe('r1');
    });

    it('retourne 401 sans en-tête Authorization (auth guard)', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/reservations',
      });

      expect(res.statusCode).toBe(401);
    });

    it('accepte une requête SANS restaurantId en query (restaurantId vient du contexte auth)', async () => {
      // Fix appliqué : ReservationQuerySchema n'exige plus restaurantId dans
      // l'URL. Le handler scope via req.restaurantId injecté par requireOrg.
      // Une requête légitime du dashboard avec ?date=… (sans restaurantId)
      // doit maintenant retourner 200.
      const app = await getApp();
      vi.spyOn(ReservationService, 'findByRestaurant').mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof ReservationService.findByRestaurant>>,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/reservations?date=2099-06-05',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.findByRestaurant).toHaveBeenCalledWith('test-rest-1', '2099-06-05');
    });

    it('rejette une date invalide avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/reservations?date=not-a-date',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(400);
      expect(ReservationService.findByRestaurant).not.toHaveBeenCalled();
    });
  });

  describe('GET /restaurants/:id/availability (public)', () => {
    it("retourne les créneaux disponibles (route publique, pas d'auth requise)", async () => {
      const app = await getApp();
      // Page /book : surface en ligne, la route transmet le délai minimum du restaurant (2 h ici).
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
        minLeadTimeMinutes: 120,
      } as unknown as Awaited<ReturnType<typeof db.restaurantExposureSettings.findUnique>>);
      const availability = {
        restaurantId: 'rest-123',
        date: '2099-06-05',
        partySize: 2,
        slots: ['12:00', '12:30', '13:00'],
        allSlots: [],
      };
      vi.spyOn(ReservationService, 'availability').mockResolvedValue(
        availability as unknown as Awaited<ReturnType<typeof ReservationService.availability>>,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/rest-123/availability?date=2099-06-05&partySize=2',
        // Pas d'Authorization → la route est publique
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.availability).toHaveBeenCalledWith('rest-123', '2099-06-05', 2, {
        minLeadTimeMinutes: 120,
      });
      expect(res.json()).toEqual(availability);
    });

    it('utilise partySize=2 par défaut si non fourni', async () => {
      const app = await getApp();
      vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue(null);
      vi.spyOn(ReservationService, 'availability').mockResolvedValue({
        restaurantId: 'rest-123',
        date: '2099-06-05',
        partySize: 2,
        slots: [],
        allSlots: [],
      } as unknown as Awaited<ReturnType<typeof ReservationService.availability>>);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/rest-123/availability?date=2099-06-05',
      });

      expect(res.statusCode).toBe(200);
      // Sans réglages, le délai par défaut (30 min) s'applique.
      expect(ReservationService.availability).toHaveBeenCalledWith('rest-123', '2099-06-05', 2, {
        minLeadTimeMinutes: 30,
      });
    });

    it('rejette partySize > 20 avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/rest-123/availability?date=2099-06-05&partySize=50',
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejette une date manquante avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/rest-123/availability',
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /reservations (service interne legacy)', () => {
    const serviceToken = ['test', 'reservation', 'service', 'token', 'fixture'].join('-');
    const serviceHeaders = {
      'x-sokar-reservation-token': serviceToken,
    };

    it('rejette une requête sans jeton de service', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        payload: {
          restaurantId: 'rest-123',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 2,
          customerName: 'Alice',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('rejette un jeton de service invalide', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: {
          'x-sokar-reservation-token': ['wrong', 'reservation', 'token', 'fixture'].join('-'),
        },
        payload: {
          restaurantId: 'rest-123',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 2,
          customerName: 'Alice',
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('ne redevient pas publique si le secret est absent', async () => {
      const app = await getApp();
      const previous = process.env.RESERVATION_SERVICE_TOKEN;
      delete process.env.RESERVATION_SERVICE_TOKEN;

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/reservations',
          headers: serviceHeaders,
          payload: {
            restaurantId: 'rest-123',
            reservedAt: '2099-06-05T19:00:00.000Z',
            partySize: 2,
            customerName: 'Alice',
          },
        });

        expect(res.statusCode).toBe(503);
      } finally {
        if (previous === undefined) delete process.env.RESERVATION_SERVICE_TOKEN;
        else process.env.RESERVATION_SERVICE_TOKEN = previous;
      }
    });

    it('crée une réservation et retourne 201', async () => {
      const app = await getApp();
      const created = {
        id: 'res-new',
        restaurantId: 'rest-123',
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+336****0001',
        status: 'CONFIRMED',
      };
      vi.spyOn(ReservationService, 'create').mockResolvedValue(
        created as unknown as Awaited<ReturnType<typeof ReservationService.create>>,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: serviceHeaders,
        payload: {
          restaurantId: 'rest-123',
          callId: 'call-abc',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 4,
          customerName: 'Alice',
          customerPhone: '+33612345678',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(ReservationService.create).toHaveBeenCalledWith({
        restaurantId: 'rest-123',
        callId: 'call-abc',
        reservedAt: new Date('2099-06-05T19:00:00.000Z'),
        partySize: 4,
        customerName: 'Alice',
        customerPhone: '+33612345678',
      });
      expect(res.json().id).toBe('res-new');
    });

    describe('délai minimum de réservation (création de la page /book)', () => {
      const NOW = new Date('2026-07-02T13:00:00.000Z');
      const post = async (minutesFromNow: number) => {
        const app = await getApp();
        return app.inject({
          method: 'POST',
          url: '/reservations',
          headers: serviceHeaders,
          payload: {
            restaurantId: 'rest-123',
            reservedAt: new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString(),
            partySize: 2,
            customerName: 'Alice',
            customerPhone: '+33612345678',
          },
        });
      };
      const withLead = (minLeadTimeMinutes: number | null) =>
        vi
          .mocked(db.restaurantExposureSettings.findUnique)
          .mockResolvedValue(
            (minLeadTimeMinutes === null ? null : { minLeadTimeMinutes }) as unknown as Awaited<
              ReturnType<typeof db.restaurantExposureSettings.findUnique>
            >,
          );

      beforeEach(() => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(NOW);
        vi.spyOn(ReservationService, 'create').mockResolvedValue({
          id: 'res-new',
        } as unknown as Awaited<ReturnType<typeof ReservationService.create>>);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('refuse un créneau dans le délai : 409, code explicite, message en français, rien n’est créé', async () => {
        withLead(120);

        const res = await post(90);

        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({
          error:
            'Ce créneau est trop proche : ce restaurant accepte les réservations au moins 2 h à l’avance.',
          code: 'INSUFFICIENT_LEAD_TIME',
          minLeadTimeMinutes: 120,
        });
        expect(ReservationService.create).not.toHaveBeenCalled();
      });

      it('accepte un créneau qui commence exactement à maintenant + délai', async () => {
        withLead(120);

        const res = await post(120);

        expect(res.statusCode).toBe(201);
        expect(ReservationService.create).toHaveBeenCalledTimes(1);
      });

      it('refuse une minute avant la limite', async () => {
        withLead(120);
        expect((await post(119)).statusCode).toBe(409);
      });

      it('refuse un créneau déjà commencé, même sans réglages (délai par défaut de 30 min)', async () => {
        withLead(null);

        expect((await post(-5)).statusCode).toBe(409);
        expect((await post(29)).statusCode).toBe(409);
        expect((await post(30)).statusCode).toBe(201);
      });

      it('un restaurant à 0 min n’exclut que le passé', async () => {
        withLead(0);

        expect((await post(-1)).statusCode).toBe(409);
        expect((await post(1)).statusCode).toBe(201);
      });
    });

    it('rejette un partySize > 20 (Zod max(20)) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: serviceHeaders,
        payload: {
          restaurantId: 'rest-123',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 50,
          customerName: 'Alice',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(ReservationService.create).not.toHaveBeenCalled();
    });

    it('rejette un customerPhone invalide (regex E.164) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: serviceHeaders,
        payload: {
          restaurantId: 'rest-123',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 2,
          customerName: 'Alice',
          customerPhone: 'pas-un-numero',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejette un customerName vide avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: serviceHeaders,
        payload: {
          restaurantId: 'rest-123',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 2,
          customerName: '',
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('mappe SLOT_NOT_AVAILABLE en 409 Conflict', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'create').mockRejectedValue(new Error('SLOT_NOT_AVAILABLE'));

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: serviceHeaders,
        payload: {
          restaurantId: 'rest-123',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 2,
          customerName: 'Alice',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: 'SLOT_NOT_AVAILABLE',
        statusCode: 409,
      });
    });

    it('mappe un replay inter-restaurant en 409 sans exposer la réservation', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'create').mockRejectedValue(
        new Error(RESERVATION_REPLAY_SCOPE_MISMATCH),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
        headers: serviceHeaders,
        payload: {
          restaurantId: 'rest-123',
          callId: 'call-cross-tenant',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 2,
          customerName: 'Alice',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'RESERVATION_REPLAY_REJECTED' });
    });
  });

  describe('PATCH /reservations/:id', () => {
    it('met à jour le statut avec une valeur valide (réservée via @sokar/shared)', async () => {
      const app = await getApp();
      const updated = {
        id: 'res-1',
        status: 'CANCELLED',
        restaurantId: 'test-rest-1',
        reservedAt: new Date(),
        partySize: 2,
        customerName: 'Alice',
      };
      vi.spyOn(ReservationService, 'update').mockResolvedValue(
        updated as unknown as Awaited<ReturnType<typeof ReservationService.update>>,
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/reservations/res-1',
        headers: { authorization: 'Bearer test' },
        payload: { status: 'CANCELLED' },
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.update).toHaveBeenCalledWith('res-1', 'test-rest-1', {
        status: 'CANCELLED',
      });
      expect(res.json().status).toBe('CANCELLED');
    });

    it('rejette un statut invalide (non dans @sokar/shared) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/reservations/res-1',
        headers: { authorization: 'Bearer test' },
        payload: { status: 'BOGUS_STATUS' },
      });

      expect(res.statusCode).toBe(400);
      expect(ReservationService.update).not.toHaveBeenCalled();
    });

    it('rejette partySize hors bornes (1-20) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/reservations/res-1',
        headers: { authorization: 'Bearer test' },
        payload: { partySize: 0 },
      });

      expect(res.statusCode).toBe(400);
    });

    it('accepte plusieurs champs simultanément (status + partySize + customerName)', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'update').mockResolvedValue({
        id: 'res-1',
      } as unknown as Awaited<ReturnType<typeof ReservationService.update>>);

      const res = await app.inject({
        method: 'PATCH',
        url: '/reservations/res-1',
        headers: { authorization: 'Bearer test' },
        payload: { status: 'SEATED', partySize: 6, customerName: 'Alice Updated' },
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.update).toHaveBeenCalledWith('res-1', 'test-rest-1', {
        status: 'SEATED',
        partySize: 6,
        customerName: 'Alice Updated',
      });
    });

    it('retourne 401 sans en-tête Authorization', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/reservations/res-1',
        payload: { status: 'CANCELLED' },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('DELETE /reservations/:id', () => {
    it('supprime la réservation et retourne 204', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'delete').mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'DELETE',
        url: '/reservations/res-1',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(204);
      expect(ReservationService.delete).toHaveBeenCalledWith('res-1', 'test-rest-1');
    });

    it('retourne 401 sans en-tête Authorization', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'DELETE',
        url: '/reservations/res-1',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /reservations/:id/allocate-table', () => {
    it('alloue une table avec succès et retourne 200', async () => {
      const app = await getApp();
      const updated = {
        id: 'res-1',
        restaurantId: 'test-rest-1',
        tableId: 'table-1',
        table: { name: 'T1' },
        reservedAt: new Date('2099-06-05T19:00:00'),
        partySize: 2,
        customerName: 'Alice',
        status: 'CONFIRMED',
      };
      vi.spyOn(ReservationService, 'allocateTable').mockResolvedValue(
        updated as unknown as Awaited<ReturnType<typeof ReservationService.allocateTable>>,
      );

      const res = await app.inject({
        method: 'POST',
        url: '/reservations/res-1/allocate-table',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.allocateTable).toHaveBeenCalledWith('res-1', 'test-rest-1');
      expect(res.json().tableId).toBe('table-1');
    });

    it('retourne 409 si allocateTable lève SLOT_NOT_AVAILABLE', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'allocateTable').mockRejectedValue(
        new Error('SLOT_NOT_AVAILABLE'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/reservations/res-1/allocate-table',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: 'SLOT_NOT_AVAILABLE',
        statusCode: 409,
      });
    });

    it('retourne 401 sans en-tête Authorization', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations/res-1/allocate-table',
      });

      expect(res.statusCode).toBe(401);
    });

    it('propage une erreur inattendue en 500', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'allocateTable').mockRejectedValue(new Error('boom'));

      const res = await app.inject({
        method: 'POST',
        url: '/reservations/res-1/allocate-table',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(500);
    });
  });
});
