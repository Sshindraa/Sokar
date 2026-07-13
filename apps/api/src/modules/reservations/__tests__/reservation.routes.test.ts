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
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { ReservationService } from '../reservation.service';

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
      expect(ReservationService.availability).toHaveBeenCalledWith('rest-123', '2099-06-05', 2);
      expect(res.json()).toEqual(availability);
    });

    it('utilise partySize=2 par défaut si non fourni', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService, 'availability').mockResolvedValue({
        restaurantId: 'rest-123',
        date: '2099-06-05',
        partySize: 2,
        slots: [],
        allSlots: [],
      } as any);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/rest-123/availability?date=2099-06-05',
      });

      expect(res.statusCode).toBe(200);
      expect(ReservationService.availability).toHaveBeenCalledWith('rest-123', '2099-06-05', 2);
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

  describe('POST /reservations (public — pipeline vocal Telnyx)', () => {
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
        payload: {
          restaurantId: 'rest-123',
          callId: 'call-abc',
          reservedAt: '2099-06-05T19:00:00.000Z',
          partySize: 4,
          customerName: 'Alice',
          customerPhone: '+33612345678',
        },
        // Pas d'Authorization → public, appelé par le pipeline vocal
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

    it('rejette un partySize > 20 (Zod max(20)) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/reservations',
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
});
