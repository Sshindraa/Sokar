import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TableAllocationService } from '../table-allocation.service';
import { ServiceCopilotDelayImpactService } from '../service-copilot-delay-impact.service';

function makePrismaMock() {
  const reservation = { findFirst: vi.fn() };
  const waitingListEntry = { findMany: vi.fn() };
  return { prisma: { reservation, waitingListEntry } as any, reservation, waitingListEntry };
}

const delayedReservation = {
  id: 'reservation-late',
  customerName: 'Camille Martin',
  partySize: 2,
  tableId: 'table-12',
  startsAt: new Date('2026-07-21T17:30:00.000Z'),
  endsAt: new Date('2026-07-21T19:00:00.000Z'),
  table: { id: 'table-12', name: 'T12', capacity: 2, sectionId: 'terrasse' },
};

describe('ServiceCopilotDelayImpactService', () => {
  let mocks: ReturnType<typeof makePrismaMock>;
  let service: ServiceCopilotDelayImpactService;
  let suggestSpy: ReturnType<typeof vi.spyOn>;
  let availableSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks = makePrismaMock();
    service = new ServiceCopilotDelayImpactService(mocks.prisma);
    suggestSpy = vi.spyOn(TableAllocationService.prototype, 'suggest').mockResolvedValue([]);
    availableSpy = vi
      .spyOn(TableAllocationService.prototype, 'isTableAvailable')
      .mockResolvedValue(false);
  });

  it('propose une chaîne sûre : table alternative puis groupe de liste d’attente', async () => {
    mocks.reservation.findFirst.mockResolvedValue(delayedReservation);
    mocks.waitingListEntry.findMany.mockResolvedValue([
      {
        id: 'waiting-1',
        partySize: 2,
        customerFirstName: 'Lina',
        customerLastName: 'Dupont',
        slotStart: new Date('2026-07-21T17:30:00.000Z'),
        slotEnd: new Date('2026-07-21T19:00:00.000Z'),
      },
    ]);
    suggestSpy.mockResolvedValue([
      {
        table: { id: 'table-7', name: 'T7', capacity: 2, minCapacity: 1, sectionId: 'salle' },
        score: 100,
        reasons: ['Capacité exacte'],
      },
    ]);
    availableSpy.mockResolvedValue(true);

    const result = await service.simulate({
      restaurantId: 'rest-1',
      reservationId: 'reservation-late',
      delayMinutes: 20,
      now: new Date('2026-07-21T17:23:00.000Z'),
    });

    expect(result.feasible).toBe(true);
    expect(result.alternativeTable?.name).toBe('T7');
    expect(result.waitingListEntry).toMatchObject({ customerName: 'Lina Dupont', partySize: 2 });
    expect(result.delayedReservation?.proposedStartsAt).toBe('2026-07-21T17:50:00.000Z');
    expect(availableSpy).toHaveBeenCalledWith({
      tableId: 'table-12',
      startsAt: new Date('2026-07-21T17:30:00.000Z'),
      endsAt: new Date('2026-07-21T19:00:00.000Z'),
      excludeReservationId: 'reservation-late',
    });
    expect(result.safeguards).toHaveLength(2);
  });

  it('refuse le plan si aucune table alternative ne peut absorber le retard', async () => {
    mocks.reservation.findFirst.mockResolvedValue(delayedReservation);
    suggestSpy.mockResolvedValue([]);

    const result = await service.simulate({
      restaurantId: 'rest-1',
      reservationId: 'reservation-late',
      delayMinutes: 20,
    });

    expect(result.feasible).toBe(false);
    expect(result.summary).toContain('Aucune table alternative');
    expect(mocks.waitingListEntry.findMany).not.toHaveBeenCalled();
  });

  it('ne présente pas de chaîne si la table initiale reste en conflit', async () => {
    mocks.reservation.findFirst.mockResolvedValue(delayedReservation);
    mocks.waitingListEntry.findMany.mockResolvedValue([
      {
        id: 'waiting-1',
        partySize: 2,
        customerFirstName: 'Lina',
        customerLastName: null,
        slotStart: new Date('2026-07-21T17:30:00.000Z'),
        slotEnd: new Date('2026-07-21T19:00:00.000Z'),
      },
    ]);
    suggestSpy.mockResolvedValue([
      {
        table: { id: 'table-7', name: 'T7', capacity: 2, minCapacity: 1, sectionId: 'salle' },
        score: 100,
        reasons: ['Capacité exacte'],
      },
    ]);
    availableSpy.mockResolvedValue(false);

    const result = await service.simulate({
      restaurantId: 'rest-1',
      reservationId: 'reservation-late',
      delayMinutes: 20,
    });

    expect(result.feasible).toBe(false);
    expect(result.alternativeTable?.name).toBe('T7');
    expect(result.waitingListEntry).toBeUndefined();
    expect(result.summary).toContain('aucun groupe de liste d’attente');
  });
});
