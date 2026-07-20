/**
 * Route-level tests for floorPlanRoutes.
 *
 * Pattern: Fastify `inject()` against `getApp()` (shared helper with
 * requireOrg mocked to inject `req.restaurantId = 'test-rest-1'`).
 * We spy on `FloorPlanService` methods to drive the route contract
 * (status, tenant scoping, Zod validation) without touching the DB.
 *
 * Covers Phases 2 & 4:
 * - PATCH .../state  → 204 + transitionState called with scoped id
 * - POST  .../walk-ins → 201 + createWalkIn called with scoped id
 * - tenant isolation: `:id` differing from auth context → 403
 * - Zod rejection: missing tableId → 400
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { FloorPlanService } from '../floor-plan.service';
import { ReservationService } from '../../agentic-reservations/core/reservation.service';
import { TableAllocationService, TableAllocationError } from '../table-allocation.service';

describe('floorPlanRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('PATCH /restaurants/:id/floor-plan/state', () => {
    it('retourne 204 et appelle transitionState avec le bon scope', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService.prototype, 'transitionState').mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-1/state',
        headers: { authorization: 'Bearer test' },
        payload: { reservationId: 'res-1', state: 'SEATED' },
      });

      expect(res.statusCode).toBe(204);
      expect(ReservationService.prototype.transitionState).toHaveBeenCalledWith({
        reservationId: 'res-1',
        restaurantId: 'test-rest-1',
        toState: 'SEATED',
        actor: 'test-rest-1',
      });
    });

    it('retourne 403 si :id diffère du contexte auth (tenant isolation)', async () => {
      const app = await getApp();
      const spy = vi
        .spyOn(ReservationService.prototype, 'transitionState')
        .mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/other-rest/floor-plan/reservations/res-1/state',
        headers: { authorization: 'Bearer test' },
        payload: { reservationId: 'res-1', state: 'SEATED' },
      });

      expect(res.statusCode).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it('retourne 400 si state invalide (Zod)', async () => {
      const app = await getApp();
      const spy = vi
        .spyOn(ReservationService.prototype, 'transitionState')
        .mockResolvedValue(undefined);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-1/state',
        headers: { authorization: 'Bearer test' },
        payload: { reservationId: 'res-1', state: 'CANCELLED' },
      });

      expect(res.statusCode).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it('retourne 409 si la table est indisponible (TableAllocationError)', async () => {
      const app = await getApp();
      vi.spyOn(ReservationService.prototype, 'transitionState').mockRejectedValue(
        new TableAllocationError('TABLE_NOT_AVAILABLE', 'Table non disponible'),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-1/state',
        headers: { authorization: 'Bearer test' },
        payload: { reservationId: 'res-1', state: 'SEATED' },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /restaurants/:id/floor-plan/walk-ins', () => {
    it('retourne 201 et appelle createWalkIn avec le bon scope', async () => {
      const app = await getApp();
      vi.spyOn(FloorPlanService.prototype, 'createWalkIn').mockResolvedValue({ id: 'walk-1' });

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/floor-plan/walk-ins',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 'table-1', partySize: 3, idempotencyKey: 'k1' },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBe('walk-1');
      expect(FloorPlanService.prototype.createWalkIn).toHaveBeenCalledWith({
        restaurantId: 'test-rest-1',
        tableId: 'table-1',
        partySize: 3,
        idempotencyKey: 'k1',
      });
    });

    it('retourne 403 si :id diffère du contexte auth (tenant isolation)', async () => {
      const app = await getApp();
      const spy = vi
        .spyOn(FloorPlanService.prototype, 'createWalkIn')
        .mockResolvedValue({ id: 'walk-1' });

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/other-rest/floor-plan/walk-ins',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 'table-1', partySize: 3, idempotencyKey: 'k1' },
      });

      expect(res.statusCode).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });

    it('retourne 400 si tableId manquant (Zod)', async () => {
      const app = await getApp();
      const spy = vi
        .spyOn(FloorPlanService.prototype, 'createWalkIn')
        .mockResolvedValue({ id: 'walk-1' });

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/floor-plan/walk-ins',
        headers: { authorization: 'Bearer test' },
        payload: { partySize: 3, idempotencyKey: 'k1' },
      });

      expect(res.statusCode).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it('retourne 400 si partySize hors borne (Zod)', async () => {
      const app = await getApp();
      const spy = vi
        .spyOn(FloorPlanService.prototype, 'createWalkIn')
        .mockResolvedValue({ id: 'walk-1' });

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/floor-plan/walk-ins',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 'table-1', partySize: 0, idempotencyKey: 'k1' },
      });

      expect(res.statusCode).toBe(400);
      expect(spy).not.toHaveBeenCalled();
    });

    it('retourne 409 si la table est indisponible (TableAllocationError)', async () => {
      const app = await getApp();
      vi.spyOn(FloorPlanService.prototype, 'createWalkIn').mockRejectedValue(
        new TableAllocationError('TABLE_NOT_AVAILABLE', 'Table non disponible'),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/test-rest-1/floor-plan/walk-ins',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 'table-1', partySize: 3, idempotencyKey: 'k1' },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe('Phase 5 — suggest-table / assign-table', () => {
    it('suggest-table retourne la reco read-only (204+json, pas de mutation)', async () => {
      const app = await getApp();
      vi.mocked(db.reservation.findUnique).mockResolvedValue({
        restaurantId: 'test-rest-1',
        partySize: 2,
        startsAt: new Date(),
        endsAt: new Date(),
        tableId: 't-current',
      } as never);
      const allocateSpy = vi
        .spyOn(TableAllocationService.prototype, 'allocate')
        .mockResolvedValue({ id: 't-suggested', capacity: 2, sectionId: 'sec-1' } as never);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-1/suggest-table',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tableId).toBe('t-suggested');
      expect(allocateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: 'test-rest-1', partySize: 2 }),
      );
    });

    it('suggest-table retourne 404 si la réservation nexiste pas (tenant scope)', async () => {
      const app = await getApp();
      vi.mocked(db.reservation.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-404/suggest-table',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(404);
    });

    it('assign-table retourne 204 et appelle reallocate (commit transactionnel)', async () => {
      const app = await getApp();
      const reallocateSpy = vi
        .spyOn(TableAllocationService.prototype, 'reallocate')
        .mockResolvedValue({ id: 'res-1', tableId: 't-new' } as never);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-1/assign-table',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 't-new' },
      });

      expect(res.statusCode).toBe(204);
      expect(reallocateSpy).toHaveBeenCalledWith('res-1', 't-new');
    });

    it('assign-table retourne 409 si la table est indisponible (TableAllocationError)', async () => {
      const app = await getApp();
      vi.spyOn(TableAllocationService.prototype, 'reallocate').mockRejectedValue(
        new TableAllocationError('TABLE_NOT_AVAILABLE', 'Target table is not available'),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/test-rest-1/floor-plan/reservations/res-1/assign-table',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 't-taken' },
      });

      expect(res.statusCode).toBe(409);
    });

    it('assign-table retourne 403 si :id diffère du contexte auth (tenant isolation)', async () => {
      const app = await getApp();
      const spy = vi
        .spyOn(TableAllocationService.prototype, 'reallocate')
        .mockResolvedValue({ id: 'res-1', tableId: 't-new' } as never);

      const res = await app.inject({
        method: 'PATCH',
        url: '/restaurants/other-rest/floor-plan/reservations/res-1/assign-table',
        headers: { authorization: 'Bearer test' },
        payload: { tableId: 't-new' },
      });

      expect(res.statusCode).toBe(403);
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
