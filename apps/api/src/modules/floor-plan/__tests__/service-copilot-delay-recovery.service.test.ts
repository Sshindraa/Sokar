import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableAllocationService } from '../table-allocation.service';
import { ServiceCopilotDelayImpactService } from '../service-copilot-delay-impact.service';
import {
  DelayRecoveryConflictError,
  ServiceCopilotDelayRecoveryService,
} from '../service-copilot-delay-recovery.service';

function makePrismaMock() {
  const tx = {
    $queryRaw: vi.fn(),
    reservation: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    waitingListEntry: { findFirst: vi.fn(), update: vi.fn() },
    table: { findFirst: vi.fn() },
    reservationAuditLog: { create: vi.fn(), findFirst: vi.fn() },
  };
  const prisma = {
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    reservationAuditLog: { findFirst: vi.fn() },
  };
  return { prisma: prisma as any, tx };
}

const preflight = {
  feasible: true,
  summary: 'Plan sûr.',
  delayMinutes: 20,
  delayedReservation: {
    id: 'reservation-1',
    customerName: 'Camille Martin',
    originalTableName: 'T12',
    originalStartsAt: '2026-07-21T17:30:00.000Z',
    proposedStartsAt: '2026-07-21T17:50:00.000Z',
  },
  alternativeTable: { id: 'table-7', name: 'T7', capacity: 2, sectionId: 'salle' },
  waitingListEntry: {
    id: 'waiting-1',
    customerName: 'Lina Dupont',
    partySize: 2,
    requestedStartsAt: '2026-07-21T17:30:00.000Z',
    proposedStartsAt: '2026-07-21T17:30:00.000Z',
    proposedEndsAt: '2026-07-21T19:00:00.000Z',
    isAvailableNow: false,
  },
  safeguards: [],
};

describe('ServiceCopilotDelayRecoveryService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applique les deux mutations seulement après revalidation sous verrou', async () => {
    const { prisma, tx } = makePrismaMock();
    const service = new ServiceCopilotDelayRecoveryService(prisma);
    vi.spyOn(ServiceCopilotDelayImpactService.prototype, 'simulate').mockResolvedValue(preflight);
    vi.spyOn(TableAllocationService.prototype, 'isTableAvailable').mockResolvedValue(true);
    tx.reservation.findFirst.mockResolvedValue({
      id: 'reservation-1',
      restaurantId: 'rest-1',
      partySize: 2,
      tableId: 'table-12',
      startsAt: new Date('2026-07-21T17:30:00.000Z'),
      endsAt: new Date('2026-07-21T19:00:00.000Z'),
    });
    tx.waitingListEntry.findFirst.mockResolvedValue({
      id: 'waiting-1',
      restaurantId: 'rest-1',
      partySize: 2,
      customerFirstName: 'Lina',
      customerLastName: 'Dupont',
      customerPhone: '+33600000000',
      customerEmail: null,
      slotStart: new Date('2026-07-21T17:30:00.000Z'),
      slotEnd: new Date('2026-07-21T19:00:00.000Z'),
    });
    tx.table.findFirst
      .mockResolvedValueOnce({ id: 'table-12', capacity: 2, minCapacity: 1 })
      .mockResolvedValueOnce({ id: 'table-7', capacity: 2, minCapacity: 1 });
    tx.reservation.update.mockResolvedValue({ id: 'reservation-1' });
    tx.reservation.create.mockResolvedValue({ id: 'promoted-1' });

    const result = await service.apply({
      restaurantId: 'rest-1',
      reservationId: 'reservation-1',
      delayMinutes: 20,
      alternativeTableId: 'table-7',
      waitingListEntryId: 'waiting-1',
      actor: 'manager-1',
      waitingListAcceptanceConfirmed: true,
    });

    expect(result).toEqual({
      delayedReservationId: 'reservation-1',
      promotedReservationId: 'promoted-1',
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(4);
    expect(tx.reservation.update).toHaveBeenCalledWith({
      where: { id: 'reservation-1' },
      data: {
        tableId: 'table-7',
        startsAt: new Date('2026-07-21T17:50:00.000Z'),
        endsAt: new Date('2026-07-21T19:20:00.000Z'),
      },
    });
    expect(tx.waitingListEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'waiting-1' },
        data: expect.objectContaining({ status: 'PROMOTED' }),
      }),
    );
    expect(tx.reservationAuditLog.create).toHaveBeenCalledTimes(2);
  });

  it('n’écrit rien si le plan à confirmer ne correspond plus au préflight', async () => {
    const { prisma } = makePrismaMock();
    const service = new ServiceCopilotDelayRecoveryService(prisma);
    vi.spyOn(ServiceCopilotDelayImpactService.prototype, 'simulate').mockResolvedValue(preflight);

    await expect(
      service.apply({
        restaurantId: 'rest-1',
        reservationId: 'reservation-1',
        delayMinutes: 20,
        alternativeTableId: 'other-table',
        waitingListEntryId: 'waiting-1',
        actor: 'manager-1',
        waitingListAcceptanceConfirmed: true,
      }),
    ).rejects.toBeInstanceOf(DelayRecoveryConflictError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse toute promotion sans acceptation explicite du groupe', async () => {
    const { prisma } = makePrismaMock();
    const service = new ServiceCopilotDelayRecoveryService(prisma as any);
    const simulate = vi.spyOn(ServiceCopilotDelayImpactService.prototype, 'simulate');

    await expect(
      service.apply({
        restaurantId: 'rest-1',
        reservationId: 'reservation-1',
        delayMinutes: 20,
        alternativeTableId: 'table-7',
        waitingListEntryId: 'waiting-1',
        actor: 'manager-1',
        waitingListAcceptanceConfirmed: false,
      }),
    ).rejects.toThrow('accepte la table');
    expect(simulate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retourne le premier résultat pour une opération déjà appliquée, même sans clé cliente', async () => {
    const { prisma } = makePrismaMock();
    prisma.reservationAuditLog.findFirst.mockResolvedValue({
      metadata: { promotedReservationId: 'promoted-1' },
    });
    const service = new ServiceCopilotDelayRecoveryService(prisma as any);

    await expect(
      service.apply({
        restaurantId: 'rest-1',
        reservationId: 'reservation-1',
        delayMinutes: 20,
        alternativeTableId: 'table-7',
        waitingListEntryId: 'waiting-1',
        actor: 'manager-1',
        waitingListAcceptanceConfirmed: true,
      }),
    ).resolves.toEqual({
      delayedReservationId: 'reservation-1',
      promotedReservationId: 'promoted-1',
      idempotent: true,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuse de modifier le retard lié à un signalement vocal', async () => {
    const { prisma } = makePrismaMock();
    prisma.reservationAuditLog.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ metadata: { delayMinutes: 25 } });
    const service = new ServiceCopilotDelayRecoveryService(prisma as any);

    await expect(
      service.apply({
        restaurantId: 'rest-1',
        reservationId: 'reservation-1',
        delayMinutes: 20,
        alternativeTableId: 'table-7',
        waitingListEntryId: 'waiting-1',
        actor: 'manager-1',
        waitingListAcceptanceConfirmed: true,
        delayReportId: 'delay-report-1',
      }),
    ).rejects.toThrow('ne correspond plus au retard signalé');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
