import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient, Reservation } from '@prisma/client';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service';
import {
  ReservationLifecycleService,
  ReservationNotFoundError,
} from '../reservation-lifecycle.service';

function makeReservation(overrides: Partial<Reservation> = {}): Reservation {
  const startsAt = new Date('2099-06-05T19:00:00.000Z');
  return {
    id: 'reservation-1',
    restaurantId: 'restaurant-1',
    callId: null,
    customerId: null,
    reservedAt: startsAt,
    partySize: 2,
    customerName: 'Test customer',
    customerPhone: null,
    status: 'CONFIRMED',
    confirmationStatus: 'NONE',
    confirmationSentAt: null,
    source: 'PHONE',
    channel: 'PHONE',
    state: 'CONFIRMED',
    startsAt,
    endsAt: new Date('2099-06-05T21:00:00.000Z'),
    specialRequests: null,
    createdByClient: null,
    cancellationPolicySnap: null,
    noShowPolicySnap: null,
    consents: {},
    privacyPolicyVersion: null,
    idempotencyScope: null,
    idempotencyKey: null,
    idempotencyPayloadHash: null,
    consumedHoldId: null,
    tableId: null,
    googleEventId: null,
    estimatedRevenue: null,
    giftCardRedemptionSnap: null,
    giftCardComplementAmount: null,
    createdAt: new Date('2099-06-01T00:00:00.000Z'),
    updatedAt: new Date('2099-06-01T00:00:00.000Z'),
    ...overrides,
  } as Reservation;
}

function makePrisma() {
  const tx = {
    reservation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    reservationAuditLog: {
      create: vi.fn(),
    },
    agenticHold: {
      findUnique: vi.fn(),
    },
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  } as unknown as PrismaClient;
  return { prisma, tx };
}

describe('ReservationLifecycleService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('scopes the row, projects cancellation, audits it and invalidates capacity', async () => {
    const { prisma, tx } = makePrisma();
    const previous = makeReservation();
    const updated = makeReservation({ status: 'CANCELLED', state: 'CANCELLED' });
    vi.mocked(tx.reservation.findUnique).mockResolvedValue(previous);
    vi.mocked(tx.reservation.update).mockResolvedValue(updated);
    const invalidate = vi
      .spyOn(CapacityAwareAvailabilityService, 'invalidateAvailability')
      .mockResolvedValue(undefined);

    const result = await new ReservationLifecycleService(prisma).transition({
      reservationId: previous.id,
      restaurantId: previous.restaurantId,
      toState: 'CANCELLED',
      actor: 'dashboard',
      metadata: { source: 'test' },
      observationSource: 'dashboard',
    });

    expect(tx.reservation.findUnique).toHaveBeenCalledWith({
      where: { id: previous.id, restaurantId: previous.restaurantId },
    });
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: previous.id, restaurantId: previous.restaurantId },
      data: { state: 'CANCELLED', status: 'CANCELLED' },
    });
    expect(tx.reservationAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'reservation_cancelled',
        fromState: 'CONFIRMED',
        toState: 'CANCELLED',
      }),
    });
    expect(invalidate).toHaveBeenCalledWith(previous.restaurantId);
    expect(result.capacity).toBe('released');
  });

  it('rejects a terminal-to-confirmed transition before writing', async () => {
    const { prisma, tx } = makePrisma();
    const previous = makeReservation({ status: 'CANCELLED', state: 'CANCELLED' });
    vi.mocked(tx.reservation.findUnique).mockResolvedValue(previous);

    await expect(
      new ReservationLifecycleService(prisma).transition({
        reservationId: previous.id,
        restaurantId: previous.restaurantId,
        toState: 'CONFIRMED',
        actor: 'dashboard',
      }),
    ).rejects.toThrow('Invalid state transition: CANCELLED → CONFIRMED');
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.reservationAuditLog.create).not.toHaveBeenCalled();
  });

  it('ignore une confirmation fournisseur si la réservation a déjà changé d’état', async () => {
    const { prisma, tx } = makePrisma();
    const previous = makeReservation({ status: 'CANCELLED', state: 'CANCELLED' });
    vi.mocked(tx.reservation.findUnique).mockResolvedValue(previous);

    const result = await new ReservationLifecycleService(prisma).transition({
      reservationId: previous.id,
      restaurantId: previous.restaurantId,
      toState: 'CONFIRMED',
      onlyIfFromState: 'PENDING',
      actor: 'payment:provider-webhook',
      operation: 'confirmation',
    });

    expect(result.mutated).toBe(false);
    expect(result.capacity).toBe('unchanged');
    expect(tx.reservation.update).not.toHaveBeenCalled();
    expect(tx.reservationAuditLog.create).not.toHaveBeenCalled();
  });

  it('allows an idempotent same-state operational patch without a fake audit event', async () => {
    const { prisma, tx } = makePrisma();
    const previous = makeReservation();
    const updated = makeReservation({ customerName: 'Updated customer' });
    vi.mocked(tx.reservation.findUnique).mockResolvedValue(previous);
    vi.mocked(tx.reservation.update).mockResolvedValue(updated);

    const result = await new ReservationLifecycleService(prisma).transition({
      reservationId: previous.id,
      restaurantId: previous.restaurantId,
      toState: 'CONFIRMED',
      actor: 'dashboard',
      allowAlreadyInTarget: true,
      additionalData: { customerName: 'Updated customer' },
      observationSource: 'dashboard',
    });

    expect(result.mutated).toBe(true);
    expect(result.capacity).toBe('unchanged');
    expect(tx.reservationAuditLog.create).not.toHaveBeenCalled();
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: previous.id, restaurantId: previous.restaurantId },
      data: { customerName: 'Updated customer', state: 'CONFIRMED', status: 'CONFIRMED' },
    });
  });

  it('keeps the consumed-hold release proof in the same transaction as cancellation', async () => {
    const { prisma, tx } = makePrisma();
    const previous = makeReservation({ consumedHoldId: 'hold-1' });
    const updated = makeReservation({
      consumedHoldId: 'hold-1',
      status: 'CANCELLED',
      state: 'CANCELLED',
    });
    vi.mocked(tx.reservation.findUnique).mockResolvedValue(previous);
    vi.mocked(tx.reservation.update).mockResolvedValue(updated);
    vi.mocked(tx.agenticHold.findUnique).mockResolvedValue({
      status: 'CONSUMED',
      id: 'hold-1',
    } as never);

    await new ReservationLifecycleService(prisma).transition({
      reservationId: previous.id,
      restaurantId: previous.restaurantId,
      toState: 'CANCELLED',
      actor: 'agent:test',
      auditConsumedHoldRelease: true,
    });

    expect(tx.reservationAuditLog.create).toHaveBeenCalledTimes(2);
    expect(tx.reservationAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event: 'hold_released', holdId: 'hold-1' }),
    });
    expect(tx.reservationAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event: 'reservation_cancelled' }),
    });
  });

  it('raises a stable not-found error for a missing tenant-scoped row', async () => {
    const { prisma, tx } = makePrisma();
    vi.mocked(tx.reservation.findUnique).mockResolvedValue(null);

    await expect(
      new ReservationLifecycleService(prisma).transition({
        reservationId: 'missing',
        restaurantId: 'restaurant-1',
        toState: 'CANCELLED',
        actor: 'dashboard',
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundError);
  });
});
