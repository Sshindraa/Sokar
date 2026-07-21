import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceCopilotService } from '../service-copilot.service';
import { TableAllocationService } from '../table-allocation.service';

function makePrismaMock() {
  const restaurant = { findUnique: vi.fn() };
  const reservation = { findMany: vi.fn() };
  const waitingListEntry = { findMany: vi.fn() };
  const reservationAuditLog = { findMany: vi.fn() };

  const prisma: any = {
    restaurant,
    reservation,
    waitingListEntry,
    reservationAuditLog,
  };
  return { prisma, restaurant, reservation, waitingListEntry, reservationAuditLog };
}

function makeReservation(overrides: {
  id: string;
  state: 'CONFIRMED' | 'SEATED';
  startsAt: Date;
  customerName?: string;
  partySize?: number;
  table?: { name: string } | null;
}) {
  return {
    id: overrides.id,
    restaurantId: 'rest-1',
    customerName: overrides.customerName ?? 'Martin',
    partySize: overrides.partySize ?? 2,
    state: overrides.state,
    startsAt: overrides.startsAt,
    endsAt: new Date(overrides.startsAt.getTime() + 2 * 60 * 60 * 1000),
    tableId: overrides.table ? 'table-1' : null,
    table: overrides.table ?? null,
  };
}

function makeWaitingListEntry(overrides: {
  id: string;
  slotStart: Date;
  slotEnd: Date;
  partySize?: number;
  customerFirstName?: string;
  customerLastName?: string | null;
  preferredSectionId?: string | null;
}) {
  return {
    id: overrides.id,
    restaurantId: 'rest-1',
    partySize: overrides.partySize ?? 2,
    customerFirstName: overrides.customerFirstName ?? 'Camille',
    customerLastName: overrides.customerLastName ?? null,
    customerPhone: '+33600000000',
    slotStart: overrides.slotStart,
    slotEnd: overrides.slotEnd,
    preferredSectionId: overrides.preferredSectionId ?? null,
    status: 'PENDING',
    position: 1,
  };
}

const defaultRestaurant = {
  timezone: 'Europe/Paris',
  exposureSettings: { capacitySpecials: { serviceDurationMinutes: 120 } },
};

describe('ServiceCopilotService', () => {
  let svc: ServiceCopilotService;
  let mocks: ReturnType<typeof makePrismaMock>;

  beforeEach(() => {
    mocks = makePrismaMock();
    mocks.restaurant.findUnique.mockResolvedValue(defaultRestaurant);
    mocks.reservationAuditLog.findMany.mockResolvedValue([]);
    vi.spyOn(TableAllocationService.prototype, 'suggest').mockResolvedValue([]);
    svc = new ServiceCopilotService(mocks.prisma);
  });

  describe('late-reservation', () => {
    it('recommande une réservation CONFIRMED démarrée il y a plus de 15 min', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');
      const startsAt = new Date(now.getTime() - 25 * 60_000);
      const reservation = makeReservation({
        id: 'res-late',
        state: 'CONFIRMED',
        startsAt,
      });

      mocks.reservation.findMany.mockImplementation(async (args: any) => {
        if (args.where.state === 'CONFIRMED') return [reservation];
        return [];
      });
      mocks.waitingListEntry.findMany.mockResolvedValue([]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs).toHaveLength(1);
      expect(recs[0].kind).toBe('late-reservation');
      expect(recs[0].priority).toBe('high');
      expect(recs[0].metrics?.minutesLate).toBe(25);
      expect(recs[0].title).toContain('Martin est en retard de 25 min');
      expect(recs[0].action.href).toBe('/dashboard/reservations');
    });

    it('passe en priorité critique au-delà de 30 min de retard', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');
      const startsAt = new Date(now.getTime() - 45 * 60_000);
      const reservation = makeReservation({
        id: 'res-critical',
        state: 'CONFIRMED',
        startsAt,
      });

      mocks.reservation.findMany.mockImplementation(async (args: any) => {
        if (args.where.state === 'CONFIRMED') return [reservation];
        return [];
      });
      mocks.waitingListEntry.findMany.mockResolvedValue([]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs[0].priority).toBe('critical');
      expect(recs[0].metrics?.minutesLate).toBe(45);
    });
  });

  describe('table-soon-free', () => {
    it('recommande une table SEATED libérée dans les 15 prochaines minutes', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');
      const startsAt = new Date(now.getTime() - 60 * 60_000);
      const seatedAt = new Date(now.getTime() - 110 * 60_000);
      const reservation = makeReservation({
        id: 'res-seated',
        state: 'SEATED',
        startsAt,
        table: { name: 'T5' },
      });

      mocks.reservation.findMany.mockImplementation(async (args: any) => {
        if (args.where.state === 'SEATED') return [reservation];
        return [];
      });
      mocks.reservationAuditLog.findMany.mockResolvedValue([
        { reservationId: 'res-seated', createdAt: seatedAt },
      ]);
      mocks.waitingListEntry.findMany.mockResolvedValue([]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs).toHaveLength(1);
      expect(recs[0].kind).toBe('table-soon-free');
      expect(recs[0].priority).toBe('medium');
      expect(recs[0].title).toContain('Table T5 devrait se libérer vers 20:10');
      expect(recs[0].metrics?.estimatedFreeAt).toBe(
        new Date(seatedAt.getTime() + 120 * 60_000).toISOString(),
      );
      expect(recs[0].action.href).toBe('/dashboard/floor-plan');
    });

    it('utilise startsAt en fallback si seatedAt est inconnu', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');
      const startsAt = new Date(now.getTime() - 110 * 60_000);
      const reservation = makeReservation({
        id: 'res-fallback',
        state: 'SEATED',
        startsAt,
        table: { name: 'T2' },
      });

      mocks.reservation.findMany.mockImplementation(async (args: any) => {
        if (args.where.state === 'SEATED') return [reservation];
        return [];
      });
      mocks.waitingListEntry.findMany.mockResolvedValue([]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs).toHaveLength(1);
      expect(recs[0].kind).toBe('table-soon-free');
      expect(recs[0].title).toContain('T2');
    });
  });

  describe('waiting-list-compatible', () => {
    it('recommande une entrée de file d’attente avec table compatible', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');
      const slotStart = new Date(now.getTime() + 20 * 60_000);
      const entry = makeWaitingListEntry({
        id: 'wl-1',
        slotStart,
        slotEnd: new Date(slotStart.getTime() + 90 * 60_000),
      });

      mocks.reservation.findMany.mockResolvedValue([]);
      mocks.waitingListEntry.findMany.mockResolvedValue([entry]);
      vi.spyOn(TableAllocationService.prototype, 'suggest').mockResolvedValue([
        {
          table: { id: 't1', name: 'T1', capacity: 2, minCapacity: 1, sectionId: null },
          score: 100,
          reasons: ['Capacité exacte'],
        },
      ]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs).toHaveLength(1);
      expect(recs[0].kind).toBe('waiting-list-compatible');
      expect(recs[0].priority).toBe('medium');
      expect(recs[0].metrics?.covers).toBe(2);
      expect(recs[0].title).toContain('Camille, 2 couverts');
    });

    it('passe en haute priorité si le créneau est dans moins de 10 min', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');
      const slotStart = new Date(now.getTime() + 5 * 60_000);
      const entry = makeWaitingListEntry({
        id: 'wl-2',
        slotStart,
        slotEnd: new Date(slotStart.getTime() + 90 * 60_000),
      });

      mocks.reservation.findMany.mockResolvedValue([]);
      mocks.waitingListEntry.findMany.mockResolvedValue([entry]);
      vi.spyOn(TableAllocationService.prototype, 'suggest').mockResolvedValue([
        {
          table: { id: 't1', name: 'T1', capacity: 2, minCapacity: 1, sectionId: null },
          score: 100,
          reasons: [],
        },
      ]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs[0].priority).toBe('high');
      expect(recs[0].metrics?.covers).toBe(2);
    });
  });

  describe('limites et tri', () => {
    it('limite à 3 recommandations et trie par priorité décroissante', async () => {
      const now = new Date('2026-07-17T18:00:00.000Z');

      const criticalLate = makeReservation({
        id: 'res-critical',
        state: 'CONFIRMED',
        startsAt: new Date(now.getTime() - 45 * 60_000),
      });
      const highLate = makeReservation({
        id: 'res-high',
        state: 'CONFIRMED',
        startsAt: new Date(now.getTime() - 25 * 60_000),
      });
      const seated = makeReservation({
        id: 'res-seated',
        state: 'SEATED',
        startsAt: new Date(now.getTime() - 60 * 60_000),
        table: { name: 'T4' },
      });
      const urgentWaiting = makeWaitingListEntry({
        id: 'wl-urgent',
        slotStart: new Date(now.getTime() + 5 * 60_000),
        slotEnd: new Date(now.getTime() + 95 * 60_000),
      });

      mocks.reservation.findMany.mockImplementation(async (args: any) => {
        if (args.where.state === 'CONFIRMED') return [criticalLate, highLate];
        if (args.where.state === 'SEATED') return [seated];
        return [];
      });
      mocks.reservationAuditLog.findMany.mockResolvedValue([]);
      mocks.waitingListEntry.findMany.mockResolvedValue([urgentWaiting]);

      vi.spyOn(TableAllocationService.prototype, 'suggest').mockResolvedValue([
        {
          table: { id: 't1', name: 'T1', capacity: 2, minCapacity: 1, sectionId: null },
          score: 100,
          reasons: [],
        },
      ]);

      const recs = await svc.getRecommendations('rest-1', now);

      expect(recs.length).toBeLessThanOrEqual(3);
      expect(recs[0].priority).toBe('critical');
      const priorities = recs.map((r) => r.priority);
      expect(priorities).not.toContain('medium');
    });

    it('retourne une liste vide si aucune situation ne match', async () => {
      mocks.reservation.findMany.mockResolvedValue([]);
      mocks.waitingListEntry.findMany.mockResolvedValue([]);

      const recs = await svc.getRecommendations('rest-1', new Date());

      expect(recs).toEqual([]);
    });
  });
});
