import { describe, expect, it, vi } from 'vitest';
import { ServiceCopilotDelayRecoveryHistoryService } from '../service-copilot-delay-recovery-history.service';

const snapshot = {
  alternativeTableId: 'table-12',
  waitingListEntryId: 'waiting-1',
  promotedReservationId: 'promoted-1',
  originalTableId: 'table-4',
  originalStartsAt: '2026-07-22T17:30:00.000Z',
  originalEndsAt: '2026-07-22T19:00:00.000Z',
  appliedStartsAt: '2026-07-22T17:55:00.000Z',
  appliedEndsAt: '2026-07-22T19:25:00.000Z',
  promotedStartsAt: '2026-07-22T17:30:00.000Z',
  promotedEndsAt: '2026-07-22T19:00:00.000Z',
};

function makePrismaMock(args?: { reverted?: boolean; promotedState?: 'CONFIRMED' | 'SEATED' }) {
  const promotedState = args?.promotedState ?? 'CONFIRMED';
  const reservationAuditLog = {
    findMany: vi
      .fn()
      .mockResolvedValueOnce([
        {
          reservationId: 'delayed-1',
          correlationId: 'operation-1',
          metadata: snapshot,
          createdAt: new Date('2026-07-22T17:40:00.000Z'),
          reservation: {
            customerName: 'Martin Test',
            state: 'CONFIRMED',
            tableId: 'table-12',
            startsAt: new Date(snapshot.appliedStartsAt),
            endsAt: new Date(snapshot.appliedEndsAt),
          },
        },
      ])
      .mockResolvedValueOnce(
        args?.reverted
          ? [
              {
                correlationId: 'revert:operation-1',
                createdAt: new Date('2026-07-22T17:45:00.000Z'),
              },
            ]
          : [],
      ),
  };
  const prisma = {
    restaurant: { findUnique: vi.fn().mockResolvedValue({ timezone: 'Europe/Paris' }) },
    reservationAuditLog,
    reservation: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'promoted-1',
          customerName: 'Alice Test',
          state: promotedState,
          status: promotedState,
          source: 'service_copilot_delay_recovery',
          tableId: 'table-4',
          startsAt: new Date(snapshot.promotedStartsAt),
          endsAt: new Date(snapshot.promotedEndsAt),
        },
      ]),
    },
    waitingListEntry: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: 'waiting-1',
          customerFirstName: 'Alice',
          customerLastName: 'Test',
          status: 'PROMOTED',
          promotedReservationId: 'promoted-1',
          expiresAt: new Date('2026-07-22T21:00:00.000Z'),
        },
      ]),
    },
    table: {
      findMany: vi.fn().mockResolvedValue([
        { id: 'table-4', name: 'T4', isActive: true, floorPlan: { isActive: true } },
        { id: 'table-12', name: 'T12', isActive: true, floorPlan: { isActive: true } },
      ]),
    },
  };
  return { prisma: prisma as any, reservationAuditLog };
}

describe('ServiceCopilotDelayRecoveryHistoryService', () => {
  it('reconstruit un plan appliqué et encore annulable', async () => {
    const { prisma } = makePrismaMock();
    const service = new ServiceCopilotDelayRecoveryHistoryService(prisma);

    await expect(
      service.list({
        restaurantId: 'rest-1',
        date: '2026-07-22',
        now: new Date('2026-07-22T18:00:00.000Z'),
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        operationId: 'operation-1',
        delayedReservationId: 'delayed-1',
        promotedReservationId: 'promoted-1',
        delayedCustomerName: 'Martin Test',
        waitingCustomerName: 'Alice Test',
        originalTableName: 'T4',
        alternativeTableName: 'T12',
        delayMinutes: 25,
        status: 'applied',
        revertible: true,
      }),
    ]);
  });

  it('marque durablement un plan déjà annulé', async () => {
    const { prisma } = makePrismaMock({ reverted: true, promotedState: 'SEATED' });
    const service = new ServiceCopilotDelayRecoveryHistoryService(prisma);

    const result = await service.list({
      restaurantId: 'rest-1',
      date: '2026-07-22',
      now: new Date('2026-07-22T18:00:00.000Z'),
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        status: 'reverted',
        revertible: false,
        revertedAt: '2026-07-22T17:45:00.000Z',
        blockedReason: undefined,
      }),
    );
  });

  it('explique pourquoi un plan modifié ne peut plus être annulé', async () => {
    const { prisma } = makePrismaMock({ promotedState: 'SEATED' });
    const service = new ServiceCopilotDelayRecoveryHistoryService(prisma);

    const result = await service.list({
      restaurantId: 'rest-1',
      date: '2026-07-22',
      now: new Date('2026-07-22T18:00:00.000Z'),
    });

    expect(result[0]).toEqual(
      expect.objectContaining({
        status: 'blocked',
        revertible: false,
        blockedReason: 'Le groupe promu a déjà été modifié ou installé.',
      }),
    );
  });

  it('ignore les audits dont le snapshot ne correspond pas à la date demandée', async () => {
    const { prisma, reservationAuditLog } = makePrismaMock();
    reservationAuditLog.findMany.mockReset().mockResolvedValueOnce([
      {
        reservationId: 'delayed-1',
        correlationId: 'operation-1',
        metadata: { ...snapshot, originalStartsAt: '2026-07-23T17:30:00.000Z' },
        createdAt: new Date('2026-07-22T17:40:00.000Z'),
        reservation: null,
      },
    ]);
    const service = new ServiceCopilotDelayRecoveryHistoryService(prisma);

    await expect(service.list({ restaurantId: 'rest-1', date: '2026-07-22' })).resolves.toEqual([]);
    expect(prisma.reservation.findMany).not.toHaveBeenCalled();
  });
});
