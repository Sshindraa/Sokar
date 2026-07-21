import { describe, expect, it, vi } from 'vitest';
import { ServiceCopilotPulseService } from '../service-copilot-pulse.service';

function makePrismaMock() {
  const restaurant = { findUnique: vi.fn() };
  const reservation = { count: vi.fn(), findMany: vi.fn() };
  const waitingListEntry = { count: vi.fn() };
  return {
    prisma: { restaurant, reservation, waitingListEntry } as any,
    restaurant,
    reservation,
    waitingListEntry,
  };
}

describe('ServiceCopilotPulseService', () => {
  it('priorise un retard réel et expose les compteurs utiles au service', async () => {
    const { prisma, restaurant, reservation, waitingListEntry } = makePrismaMock();
    restaurant.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });
    reservation.count
      .mockResolvedValueOnce(12)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    reservation.findMany.mockResolvedValue([{ tableId: 't1' }, { tableId: 't2' }]);
    waitingListEntry.count.mockResolvedValue(2);

    const pulse = await new ServiceCopilotPulseService(prisma).getPulse({
      restaurantId: 'resto-1',
      date: '2026-07-22',
      now: new Date('2026-07-22T17:30:00.000Z'),
    });

    expect(pulse).toMatchObject({
      date: '2026-07-22',
      isLiveDate: true,
      status: 'urgent',
      headline: '1 arrivée en retard à traiter',
      confirmedReservations: 12,
      lateArrivals: 1,
      arrivalsToSeat: 2,
      arrivalsNext30Minutes: 3,
      seatedTables: 2,
      pendingWaitingList: 2,
    });
    expect(reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ distinct: ['tableId'] }),
    );
  });

  it('ne transforme pas une date passée ou future en faux signal temps réel', async () => {
    const { prisma, restaurant, reservation, waitingListEntry } = makePrismaMock();
    restaurant.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });
    reservation.count.mockResolvedValue(5);
    reservation.findMany.mockResolvedValue([{ tableId: 't1' }]);
    waitingListEntry.count.mockResolvedValue(1);

    const pulse = await new ServiceCopilotPulseService(prisma).getPulse({
      restaurantId: 'resto-1',
      date: '2026-07-21',
      now: new Date('2026-07-22T17:30:00.000Z'),
    });

    expect(pulse).toMatchObject({
      isLiveDate: false,
      status: 'attention',
      headline: '5 réservations confirmées sur ce service',
      lateArrivals: 0,
      arrivalsToSeat: 0,
      arrivalsNext30Minutes: 0,
      seatedTables: 1,
      pendingWaitingList: 1,
    });
    expect(reservation.count).toHaveBeenCalledTimes(1);
  });

  it('signale un service calme quand aucune décision ne reste à prendre', async () => {
    const { prisma, restaurant, reservation, waitingListEntry } = makePrismaMock();
    restaurant.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });
    reservation.count.mockResolvedValue(0);
    reservation.findMany.mockResolvedValue([]);
    waitingListEntry.count.mockResolvedValue(0);

    const pulse = await new ServiceCopilotPulseService(prisma).getPulse({
      restaurantId: 'resto-1',
      date: '2026-07-22',
      now: new Date('2026-07-22T17:30:00.000Z'),
    });

    expect(pulse.status).toBe('calm');
    expect(pulse.headline).toBe('Service sous contrôle');
  });
});
