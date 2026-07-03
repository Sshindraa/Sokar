import { describe, expect, it, beforeEach } from 'vitest';
import type { Table, Reservation, AgenticHold, PrismaClient } from '@prisma/client';
import { TableAllocationService, TableAllocationError } from '../table-allocation.service.js';

type MockTable = Table & { section: { id: string; name: string; position: number } | null };

type MockReservation = Reservation;

type MockHold = AgenticHold;

function makeMockPrisma(
  initial: {
    tables?: MockTable[];
    reservations?: MockReservation[];
    holds?: MockHold[];
  } = {},
) {
  const tables = new Map(initial.tables?.map((t) => [t.id, t]) ?? []);
  const reservations = new Map(initial.reservations?.map((r) => [r.id, r]) ?? []);
  const holds = new Map(initial.holds?.map((h) => [h.id, h]) ?? []);
  const floorPlanByRestaurant = new Map<string, { id: string; restaurantId: string }>();
  for (const t of tables.values()) {
    if (!floorPlanByRestaurant.has(restaurantId)) {
      floorPlanByRestaurant.set(restaurantId, { id: t.floorPlanId, restaurantId });
    }
  }

  const prisma = {
    floorPlan: {
      findUnique: async (args: any) => {
        return floorPlanByRestaurant.get(args.where.restaurantId) ?? null;
      },
    },
    table: {
      findMany: async (args: any) => {
        let result = Array.from(tables.values());
        const where = args?.where ?? {};

        if (where.floorPlanId) {
          result = result.filter((t) => t.floorPlanId === where.floorPlanId);
        }
        if (where.isActive === true) {
          result = result.filter((t) => t.isActive);
        }
        if (where.isActive === false) {
          result = result.filter((t) => !t.isActive);
        }
        if (where.capacity?.gte) {
          result = result.filter((t) => t.capacity >= where.capacity.gte);
        }
        if (where.minCapacity?.lte) {
          result = result.filter((t) => t.minCapacity <= where.minCapacity.lte);
        }
        if (where.id?.notIn) {
          result = result.filter((t) => !where.id.notIn.includes(t.id));
        }
        if (where.sectionId) {
          result = result.filter((t) => t.sectionId === where.sectionId);
        }

        const orderBy = args?.orderBy ?? [];
        result.sort((a, b) => {
          for (const clause of orderBy) {
            if (clause.capacity) {
              const diff = a.capacity - b.capacity;
              if (diff !== 0) return clause.capacity === 'asc' ? diff : -diff;
            }
            if (clause.minCapacity) {
              const diff = a.minCapacity - b.minCapacity;
              if (diff !== 0) return clause.minCapacity === 'asc' ? diff : -diff;
            }
            if (clause.name) {
              const diff = a.name.localeCompare(b.name);
              if (diff !== 0) return clause.name === 'asc' ? diff : -diff;
            }
          }
          return 0;
        });

        return result.map((t) => ({ ...t, section: t.section }));
      },
      findUniqueOrThrow: async (args: any) => {
        const t = tables.get(args.where.id);
        if (!t) throw new Error(`Table not found: ${args.where.id}`);
        return t;
      },
    },
    reservation: {
      findFirst: async (args: any) => {
        const where = args?.where ?? {};
        const tableId = where.tableId;
        const states = where.state?.in ?? [];
        const excludeId = where.id?.not;
        const and = where.AND ?? [];

        for (const r of reservations.values()) {
          if (r.tableId !== tableId) continue;
          if (!states.includes(r.state)) continue;
          if (excludeId && r.id === excludeId) continue;
          if (and.length > 0) {
            const [startCond, endCond] = and;
            if (startCond.startsAt?.lt && !(r.startsAt! < startCond.startsAt.lt)) continue;
            if (startCond.startsAt?.gte && !(r.startsAt! >= startCond.startsAt.gte)) continue;
            if (endCond.endsAt?.gt && !(r.endsAt! > endCond.endsAt.gt)) continue;
            if (endCond.endsAt?.lte && !(r.endsAt! <= endCond.endsAt.lte)) continue;
          }
          return r;
        }
        return null;
      },
      findUniqueOrThrow: async (args: any) => {
        const r = reservations.get(args.where.id);
        if (!r) throw new Error(`Reservation not found: ${args.where.id}`);
        return r;
      },
      update: async (args: any) => {
        const r = reservations.get(args.where.id);
        if (!r) throw new Error(`Reservation not found: ${args.where.id}`);
        const updated = { ...r, ...args.data } as MockReservation;
        reservations.set(args.where.id, updated);
        return updated;
      },
    },
    agenticHold: {
      findFirst: async (args: any) => {
        const where = args?.where ?? {};
        const tableId = where.tableId;
        const status = where.status;
        const expiresAt = where.expiresAt?.gt;
        const excludeId = where.id?.not;
        const and = where.AND ?? [];

        for (const h of holds.values()) {
          if (h.tableId !== tableId) continue;
          if (status && h.status !== status) continue;
          if (expiresAt && !(h.expiresAt > expiresAt)) continue;
          if (excludeId && h.id === excludeId) continue;
          if (and.length > 0) {
            const [startCond, endCond] = and;
            if (startCond.slotStart?.lt && !(h.slotStart < startCond.slotStart.lt)) continue;
            if (startCond.slotStart?.gte && !(h.slotStart >= startCond.slotStart.gte)) continue;
            if (endCond.slotEnd?.gt && !(h.slotEnd > endCond.slotEnd.gt)) continue;
            if (endCond.slotEnd?.lte && !(h.slotEnd <= endCond.slotEnd.lte)) continue;
          }
          return h;
        }
        return null;
      },
    },
  } as unknown as PrismaClient;

  return { prisma, tables, reservations, holds };
}

function makeTable(
  overrides: Partial<MockTable> & { id: string; capacity: number; floorPlanId: string },
): MockTable {
  return {
    id: overrides.id,
    floorPlanId: overrides.floorPlanId,
    sectionId: overrides.sectionId ?? null,
    name: overrides.name ?? `Table ${overrides.id}`,
    capacity: overrides.capacity,
    minCapacity: overrides.minCapacity ?? 1,
    positionX: overrides.positionX ?? null,
    positionY: overrides.positionY ?? null,
    shape: overrides.shape ?? 'rect',
    isActive: overrides.isActive ?? true,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
    section: overrides.section ?? null,
  };
}

function makeReservation(
  overrides: Partial<MockReservation> & {
    id: string;
    tableId: string | null;
    startsAt: Date;
    endsAt: Date;
    partySize: number;
  },
): MockReservation {
  return {
    id: overrides.id,
    restaurantId: overrides.restaurantId ?? 'r-1',
    callId: overrides.callId ?? null,
    customerId: overrides.customerId ?? null,
    reservedAt: overrides.reservedAt ?? overrides.startsAt,
    partySize: overrides.partySize,
    customerName: overrides.customerName ?? 'Client',
    customerPhone: overrides.customerPhone ?? null,
    status: overrides.status ?? 'CONFIRMED',
    estimatedRevenue: overrides.estimatedRevenue ?? null,
    confirmedRevenue: overrides.confirmedRevenue ?? null,
    googleEventId: overrides.googleEventId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    channel: overrides.channel ?? 'PHONE',
    state: overrides.state ?? 'CONFIRMED',
    startsAt: overrides.startsAt,
    endsAt: overrides.endsAt,
    specialRequests: overrides.specialRequests ?? null,
    createdByClient: overrides.createdByClient ?? null,
    cancellationPolicySnap: overrides.cancellationPolicySnap ?? null,
    noShowPolicySnap: overrides.noShowPolicySnap ?? null,
    consents: overrides.consents ?? {},
    privacyPolicyVersion: overrides.privacyPolicyVersion ?? '2026-06-20',
    idempotencyScope: overrides.idempotencyScope ?? null,
    idempotencyKey: overrides.idempotencyKey ?? null,
    idempotencyPayloadHash: overrides.idempotencyPayloadHash ?? null,
    consumedHoldId: overrides.consumedHoldId ?? null,
    source: overrides.source ?? null,
    confirmationStatus: overrides.confirmationStatus ?? 'NOT_REQUIRED',
    confirmationSentAt: overrides.confirmationSentAt ?? null,
    confirmedAt: overrides.confirmedAt ?? null,
    tableId: overrides.tableId,
  };
}

function makeHold(
  overrides: Partial<MockHold> & {
    id: string;
    tableId: string | null;
    slotStart: Date;
    slotEnd: Date;
  },
): MockHold {
  return {
    id: overrides.id,
    restaurantId: overrides.restaurantId ?? 'r-1',
    type: overrides.type ?? 'HOLD',
    partySize: overrides.partySize ?? 2,
    slotStart: overrides.slotStart,
    slotEnd: overrides.slotEnd,
    channel: overrides.channel ?? 'WEB',
    quoteToken: overrides.quoteToken ?? null,
    holdToken: overrides.holdToken ?? null,
    expiresAt: overrides.expiresAt ?? new Date(Date.now() + 7 * 60 * 1000),
    consumedAt: overrides.consumedAt ?? null,
    status: overrides.status ?? 'ACTIVE',
    policyVersion: overrides.policyVersion ?? '2026-06-20',
    reservationId: overrides.reservationId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    tableId: overrides.tableId,
  };
}

const restaurantId = 'r-1';
const floorPlanId = 'fp-1';
const sectionId = 's-1';
const section = { id: sectionId, name: 'Terrasse', position: 0 };

describe('TableAllocationService', () => {
  describe('allocate', () => {
    it('choisit la plus petite table adaptée (best fit)', async () => {
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-4', floorPlanId, capacity: 4, name: 'Grande' }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2, name: 'Petite' }),
          makeTable({ id: 't-6', floorPlanId, capacity: 6, name: 'Très grande' }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 2,
        startsAt: new Date('2026-07-02T19:00:00Z'),
        endsAt: new Date('2026-07-02T21:00:00Z'),
      });

      expect(table).not.toBeNull();
      expect(table!.id).toBe('t-2');
    });

    it('respecte la préférence de section', async () => {
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({
            id: 't-inside',
            floorPlanId,
            capacity: 4,
            name: 'Intérieur',
            sectionId: null,
            section: null,
          }),
          makeTable({
            id: 't-terrasse',
            floorPlanId,
            capacity: 4,
            name: 'Terrasse',
            sectionId,
            section,
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 4,
        startsAt: new Date('2026-07-02T19:00:00Z'),
        endsAt: new Date('2026-07-02T21:00:00Z'),
        preferredSectionId: sectionId,
      });

      expect(table!.id).toBe('t-terrasse');
    });

    it('fallback sur toutes les sections si la préférence est impossible', async () => {
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({
            id: 't-inside',
            floorPlanId,
            capacity: 4,
            name: 'Intérieur',
            sectionId: null,
            section: null,
          }),
          makeTable({
            id: 't-terrasse',
            floorPlanId,
            capacity: 2,
            name: 'Terrasse',
            sectionId,
            section,
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 4,
        startsAt: new Date('2026-07-02T19:00:00Z'),
        endsAt: new Date('2026-07-02T21:00:00Z'),
        preferredSectionId: sectionId,
      });

      expect(table!.id).toBe('t-inside');
    });

    it('ignore les tables inactives', async () => {
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-active', floorPlanId, capacity: 2, name: 'Active' }),
          makeTable({
            id: 't-inactive',
            floorPlanId,
            capacity: 2,
            name: 'Inactive',
            isActive: false,
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 2,
        startsAt: new Date('2026-07-02T19:00:00Z'),
        endsAt: new Date('2026-07-02T21:00:00Z'),
      });

      expect(table!.id).toBe('t-active');
    });

    it('détecte le chevauchement avec une réservation existante', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [makeTable({ id: 't-1', floorPlanId, capacity: 2 })],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 2,
        startsAt: new Date('2026-07-02T20:00:00Z'),
        endsAt: new Date('2026-07-02T22:00:00Z'),
      });

      expect(table).toBeNull();
    });

    it('détecte le chevauchement avec un hold actif', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [makeTable({ id: 't-1', floorPlanId, capacity: 2 })],
        holds: [makeHold({ id: 'h-1', tableId: 't-1', slotStart: startsAt, slotEnd: endsAt })],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 2,
        startsAt: new Date('2026-07-02T20:00:00Z'),
        endsAt: new Date('2026-07-02T22:00:00Z'),
      });

      expect(table).toBeNull();
    });

    it('ignore les holds expirés', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [makeTable({ id: 't-1', floorPlanId, capacity: 2 })],
        holds: [
          makeHold({
            id: 'h-1',
            tableId: 't-1',
            slotStart: startsAt,
            slotEnd: endsAt,
            expiresAt: new Date('2026-07-01T00:00:00Z'),
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const table = await service.allocate({
        restaurantId,
        partySize: 2,
        startsAt: new Date('2026-07-02T20:00:00Z'),
        endsAt: new Date('2026-07-02T22:00:00Z'),
      });

      expect(table).not.toBeNull();
      expect(table!.id).toBe('t-1');
    });
  });

  describe('releaseTable', () => {
    it('met Reservation.tableId à null', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma, reservations } = makeMockPrisma({
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      await service.releaseTable('r-1');

      expect(reservations.get('r-1')?.tableId).toBeNull();
    });
  });

  describe('isTableAvailable', () => {
    it('ignore le hold exclu avec excludeHoldId', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [makeTable({ id: 't-1', floorPlanId, capacity: 2 })],
        holds: [
          makeHold({
            id: 'h-1',
            tableId: 't-1',
            slotStart: startsAt,
            slotEnd: endsAt,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const available = await service.isTableAvailable({
        tableId: 't-1',
        startsAt,
        endsAt,
        excludeHoldId: 'h-1',
      });

      expect(available).toBe(true);
    });

    it('retourne false si un autre hold occupe la table', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [makeTable({ id: 't-1', floorPlanId, capacity: 2 })],
        holds: [
          makeHold({
            id: 'h-2',
            tableId: 't-1',
            slotStart: startsAt,
            slotEnd: endsAt,
            status: 'ACTIVE',
            expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const available = await service.isTableAvailable({
        tableId: 't-1',
        startsAt,
        endsAt,
        excludeHoldId: 'h-1',
      });

      expect(available).toBe(false);
    });
  });

  describe('reallocate', () => {
    it('change la table de la réservation', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma, reservations } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 2 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2 }),
        ],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      await service.reallocate('r-1', 't-2');

      expect(reservations.get('r-1')?.tableId).toBe('t-2');
    });

    it('rejette une table trop petite', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 4 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2 }),
        ],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 4 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      await expect(service.reallocate('r-1', 't-2')).rejects.toThrow(TableAllocationError);
    });
  });
});
