import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ReservationService } from '../core/reservation.service';
import type { AuditLogService } from '../core/audit-log.service';
import type { HoldService } from '../core/hold.service';
import type { IdempotencyService } from '../core/idempotency.service';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service';
import * as observations from '../../../shared/observability/reservation-contract';

const reservationId = '550e8400-e29b-41d4-a716-446655440000';
const restaurantId = '550e8400-e29b-41d4-a716-446655440001';
const original = {
  id: reservationId,
  restaurantId,
  createdByClient: 'agent:client-a',
  customerPhone: '+33612345678',
  customerName: 'Alice',
  partySize: 2,
  reservedAt: new Date('2026-12-01T19:00:00Z'),
  startsAt: new Date('2026-12-01T19:00:00Z'),
  endsAt: new Date('2026-12-01T21:00:00Z'),
  tableId: null,
  state: 'CONFIRMED',
  status: 'CONFIRMED',
};

function makeService(
  blocker = false,
  overrides: Partial<Omit<typeof original, 'endsAt'>> & { endsAt?: Date | null } = {},
) {
  let current = { ...original, ...overrides, specialRequests: null as string | null };
  const tx = {
    restaurantExposureSettings: { findUnique: vi.fn().mockResolvedValue(null) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn().mockResolvedValue([{ id: reservationId }]),
    reservation: {
      // Deux lectures distinctes : la réservation verrouillée (where.id) et un
      // éventuel bloqueur de créneau. Le mock les distingue par le where.
      findFirst: vi
        .fn()
        .mockImplementation(async ({ where }: { where?: { id?: string } }) =>
          where?.id === reservationId
            ? current.restaurantId === restaurantId
              ? current
              : null
            : blocker
              ? { id: 'other' }
              : null,
        ),
      update: vi.fn().mockImplementation(async ({ data }) => {
        current = { ...current, ...data };
        return current;
      }),
    },
    agenticHold: { findFirst: vi.fn().mockResolvedValue(null) },
    reservationAuditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  const prisma = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  } as unknown as PrismaClient;
  const service = new ReservationService(
    prisma,
    {} as AuditLogService,
    {} as HoldService,
    {} as IdempotencyService,
  );
  return { service, tx };
}

describe('MCP reservation modification', () => {
  it('allows staff to edit a name when the reservation has no end time', async () => {
    const { service, tx } = makeService(false, { endsAt: null });
    await service.modifyReservation({
      reservationId,
      restaurantId,
      actor: 'staff:user',
      publicClient: false,
      customerName: 'Bob',
    });
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { customerName: 'Bob' } }),
    );
  });
  it('allows staff to change notes after the start, but rejects a past time change', async () => {
    const started = new Date(Date.now() - 10 * 60_000);
    const { service, tx } = makeService(false, { startsAt: started, reservedAt: started });
    const observe = vi.spyOn(observations, 'observeReservationMutation');
    await service.modifyReservation({
      reservationId,
      restaurantId,
      actor: 'staff:user',
      publicClient: false,
      specialRequests: 'Terrasse',
    });
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { specialRequests: 'Terrasse' } }),
    );
    expect(observe).toHaveBeenCalledWith(expect.objectContaining({ source: 'dashboard' }));
    await expect(
      service.modifyReservation({
        reservationId,
        restaurantId,
        actor: 'staff:user',
        publicClient: false,
        startsAt: started,
        preserveDuration: true,
      }),
    ).rejects.toHaveProperty('name', 'ReservationModificationNotAllowedError');
    await expect(
      service.modifyReservation({
        reservationId,
        restaurantId,
        actor: 'customer:personal-link',
        publicClient: false,
        customerName: 'Bob',
      }),
    ).rejects.toHaveProperty('name', 'ReservationModificationNotAllowedError');
    await expect(
      service.modifyReservation({
        reservationId,
        restaurantId,
        actor: original.createdByClient,
        publicClient: true,
        customerPhone: original.customerPhone,
        customerName: 'Bob',
      }),
    ).rejects.toHaveProperty('name', 'ReservationModificationNotAllowedError');
    observe.mockRestore();
  });
  it('modifies notes in the transaction and preserves duration when moving the start', async () => {
    vi.spyOn(CapacityAwareAvailabilityService, 'invalidateAvailability').mockResolvedValue();
    const { service, tx } = makeService();
    await service.modifyReservation({
      reservationId,
      restaurantId,
      actor: 'staff:user',
      publicClient: false,
      startsAt: new Date('2026-12-02T19:00:00Z'),
      preserveDuration: true,
      specialRequests: 'Terrasse',
    });
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endsAt: new Date('2026-12-02T21:00:00Z'),
          specialRequests: 'Terrasse',
        }),
      }),
    );
    expect(tx.reservationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actor: 'staff:user',
          metadata: expect.objectContaining({
            changedFields: expect.arrayContaining(['specialRequests']),
          }),
        }),
      }),
    );
    await service.modifyReservation({
      reservationId,
      restaurantId,
      actor: 'staff:user',
      publicClient: false,
      specialRequests: null,
    });
    expect(tx.reservation.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: { specialRequests: null } }),
    );
  });

  it.each([
    [{ restaurantId: 'another-restaurant' }, 'ReservationNotFoundError'],
    [{ state: 'CANCELLED' }, 'ReservationModificationNotAllowedError'],
  ])(
    'rejects reservations outside the restaurant or in a terminal state',
    async (overrides, name) => {
      const { service, tx } = makeService(false, overrides);
      await expect(
        service.modifyReservation({
          reservationId,
          restaurantId,
          actor: 'staff:user',
          publicClient: false,
          specialRequests: 'Terrasse',
        }),
      ).rejects.toHaveProperty('name', name);
      expect(tx.reservation.update).not.toHaveBeenCalled();
    },
  );

  it('checks adapter authorization under locks before any mutation', async () => {
    const { service, tx } = makeService();
    const beforeModify = vi.fn(async () => {
      throw new Error('Stale proposal');
    });
    await expect(
      service.modifyReservation({
        reservationId,
        restaurantId,
        actor: 'customer:personal-link',
        publicClient: false,
        partySize: 3,
        beforeModify,
      }),
    ).rejects.toThrow('Stale proposal');
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(beforeModify).toHaveBeenCalledWith(tx, expect.objectContaining({ id: reservationId }));
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.reservationAuditLog.create).not.toHaveBeenCalled();
  });

  it('rejects a different client before writing', async () => {
    const { service, tx } = makeService();
    await expect(
      service.modifyReservation({
        reservationId,
        restaurantId,
        actor: 'agent:other',
        publicClient: true,
        customerPhone: original.customerPhone,
        customerName: 'Bob',
      }),
    ).rejects.toHaveProperty('name', 'ReservationNotFoundError');
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it('keeps the original reservation when another booking blocks the new slot', async () => {
    const { service, tx } = makeService(true);
    await expect(
      service.modifyReservation({
        reservationId,
        restaurantId,
        actor: original.createdByClient,
        publicClient: true,
        customerPhone: original.customerPhone,
        startsAt: new Date('2026-12-02T19:00:00Z'),
        endsAt: new Date('2026-12-02T21:00:00Z'),
      }),
    ).rejects.toHaveProperty('name', 'ReservationSlotUnavailableError');
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it('updates the time and audits only changed field names', async () => {
    vi.spyOn(CapacityAwareAvailabilityService, 'invalidateAvailability').mockResolvedValue();
    const { service, tx } = makeService();
    const startsAt = new Date('2026-12-02T19:00:00Z');
    const endsAt = new Date('2026-12-02T21:00:00Z');
    const result = await service.modifyReservation({
      reservationId,
      restaurantId,
      actor: original.createdByClient,
      publicClient: true,
      customerPhone: original.customerPhone,
      startsAt,
      endsAt,
    });
    expect(result).toEqual({ reservationId, state: 'CONFIRMED', changed: true });
    expect(tx.reservation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reservedAt: startsAt, startsAt, endsAt }),
      }),
    );
    expect(tx.reservationAuditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          event: 'reservation_fields_changed',
          metadata: expect.objectContaining({
            changedFields: expect.arrayContaining(['startsAt']),
          }),
        }),
      }),
    );
  });

  it('treats an identical retry as a no-op without a second audit entry', async () => {
    vi.spyOn(CapacityAwareAvailabilityService, 'invalidateAvailability').mockResolvedValue();
    const { service, tx } = makeService();
    const args = {
      reservationId,
      restaurantId,
      actor: original.createdByClient,
      publicClient: true,
      customerPhone: original.customerPhone,
      customerName: 'Alice Martin',
    };

    const first = await service.modifyReservation(args);
    const retry = await service.modifyReservation(args);

    expect(first).toEqual({ reservationId, state: 'CONFIRMED', changed: true });
    expect(retry).toEqual({ reservationId, state: 'CONFIRMED', changed: false });
    expect(tx.reservation.update).toHaveBeenCalledTimes(1);
    expect(tx.reservationAuditLog.create).toHaveBeenCalledTimes(1);
  });
});
