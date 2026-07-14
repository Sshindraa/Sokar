import { describe, expect, it, beforeEach } from 'vitest';
import type { Table, Reservation, AgenticHold, PrismaClient } from '@prisma/client';
import { TableAllocationService, TableAllocationError } from '../table-allocation.service.js';

type MockTable = Table & {
  section: { id: string; name: string; position: number } | null;
  floorPlan?: { id: string; restaurantId: string } | null;
};

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
      findUnique: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        return floorPlanByRestaurant.get(where.restaurantId as string) ?? null;
      },
    },
    table: {
      findMany: async (args: unknown) => {
        let result = Array.from(tables.values());
        const typedArgs = args as { where?: Record<string, unknown>; orderBy?: unknown[] };
        const where = (typedArgs.where ?? {}) as Record<string, unknown>;
        const orderBy = (typedArgs.orderBy ?? []) as unknown[];

        const whereFloorPlanId = where.floorPlanId as string | undefined;
        const isActive = where.isActive as boolean | undefined;
        const capacity = where.capacity as { gte?: number } | undefined;
        const minCapacity = where.minCapacity as { lte?: number } | undefined;
        const id = where.id as { notIn?: string[] } | undefined;
        const sectionId = where.sectionId as string | undefined;

        if (whereFloorPlanId) {
          result = result.filter((t) => t.floorPlanId === whereFloorPlanId);
        }
        if (isActive === true) {
          result = result.filter((t) => t.isActive);
        }
        if (isActive === false) {
          result = result.filter((t) => !t.isActive);
        }
        const gte = capacity?.gte;
        if (typeof gte === 'number') {
          result = result.filter((t) => t.capacity >= gte);
        }
        const lte = minCapacity?.lte;
        if (typeof lte === 'number') {
          result = result.filter((t) => t.minCapacity <= lte);
        }
        const notIn = id?.notIn;
        if (Array.isArray(notIn)) {
          result = result.filter((t) => !notIn.includes(t.id));
        }
        if (sectionId) {
          result = result.filter((t) => t.sectionId === sectionId);
        }

        result.sort((a, b) => {
          for (const clause of orderBy) {
            const order = clause as Record<string, unknown>;
            const capacityDir = order.capacity as string | undefined;
            const minCapacityDir = order.minCapacity as string | undefined;
            const nameDir = order.name as string | undefined;

            if (capacityDir) {
              const diff = a.capacity - b.capacity;
              if (diff !== 0) return capacityDir === 'asc' ? diff : -diff;
            }
            if (minCapacityDir) {
              const diff = a.minCapacity - b.minCapacity;
              if (diff !== 0) return minCapacityDir === 'asc' ? diff : -diff;
            }
            if (nameDir) {
              const diff = a.name.localeCompare(b.name);
              if (diff !== 0) return nameDir === 'asc' ? diff : -diff;
            }
          }
          return 0;
        });

        return result.map((t) => ({ ...t, section: t.section }));
      },
      findUniqueOrThrow: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const id = where.id as string;
        const t = tables.get(id);
        if (!t) throw new Error(`Table not found: ${id}`);
        return t;
      },
    },
    reservation: {
      findFirst: async (args: unknown) => {
        const typedArgs = args as { where?: Record<string, unknown> };
        const where = (typedArgs.where ?? {}) as Record<string, unknown>;
        const tableId = where.tableId as string | undefined;
        const state = where.state as { in?: string[] } | undefined;
        const excludeId = where.id as { not?: string } | undefined;
        const and = (where.AND ?? []) as Record<string, unknown>[];

        for (const r of reservations.values()) {
          if (r.tableId !== tableId) continue;
          if (state?.in && !state.in.includes(r.state)) continue;
          if (excludeId?.not && r.id === excludeId.not) continue;
          if (and.length > 0) {
            const [startCond, endCond] = and;
            const startStartsAt = startCond.startsAt as Record<string, unknown> | undefined;
            const endEndsAt = endCond.endsAt as Record<string, unknown> | undefined;
            if (startStartsAt?.lt && !(r.startsAt! < (startStartsAt.lt as Date))) continue;
            if (startStartsAt?.gte && !(r.startsAt! >= (startStartsAt.gte as Date))) continue;
            if (endEndsAt?.gt && !(r.endsAt! > (endEndsAt.gt as Date))) continue;
            if (endEndsAt?.lte && !(r.endsAt! <= (endEndsAt.lte as Date))) continue;
          }
          return r;
        }
        return null;
      },
      findUniqueOrThrow: async (args: unknown) => {
        const where = ((args as Record<string, unknown>).where ?? {}) as Record<string, unknown>;
        const id = where.id as string;
        const r = reservations.get(id);
        if (!r) throw new Error(`Reservation not found: ${id}`);
        return r;
      },
      update: async (args: unknown) => {
        const typedArgs = args as {
          where: Record<string, unknown>;
          data?: Record<string, unknown>;
        };
        const id = typedArgs.where.id as string;
        const r = reservations.get(id);
        if (!r) throw new Error(`Reservation not found: ${id}`);
        const data = typedArgs.data ?? ({} as Record<string, unknown>);
        const updated = { ...r, ...data } as unknown as MockReservation;
        reservations.set(id, updated);
        return updated;
      },
    },
    agenticHold: {
      findFirst: async (args: unknown) => {
        const typedArgs = args as { where?: Record<string, unknown> };
        const where = (typedArgs.where ?? {}) as Record<string, unknown>;
        const tableId = where.tableId as string | undefined;
        const status = where.status as string | undefined;
        const expiresAt = where.expiresAt as { gt?: Date } | undefined;
        const excludeId = where.id as { not?: string } | undefined;
        const and = (where.AND ?? []) as Record<string, unknown>[];

        for (const h of holds.values()) {
          if (h.tableId !== tableId) continue;
          if (status && h.status !== status) continue;
          if (expiresAt?.gt && !(h.expiresAt > expiresAt.gt)) continue;
          if (excludeId?.not && h.id === excludeId.not) continue;
          if (and.length > 0) {
            const [startCond, endCond] = and;
            const startSlotStart = startCond.slotStart as Record<string, unknown> | undefined;
            const endSlotEnd = endCond.slotEnd as Record<string, unknown> | undefined;
            if (startSlotStart?.lt && !(h.slotStart < (startSlotStart.lt as Date))) continue;
            if (startSlotStart?.gte && !(h.slotStart >= (startSlotStart.gte as Date))) continue;
            if (endSlotEnd?.gt && !(h.slotEnd > (endSlotEnd.gt as Date))) continue;
            if (endSlotEnd?.lte && !(h.slotEnd <= (endSlotEnd.lte as Date))) continue;
          }
          return h;
        }
        return null;
      },
    },
    $queryRaw: async () => [{ id: 'locked' }],
    $transaction: async (fn: unknown) => {
      if (Array.isArray(fn)) {
        return Promise.all(fn as unknown[]);
      }
      return (fn as (p: typeof prisma) => unknown)(prisma);
    },
  } as unknown as PrismaClient;

  return { prisma, tables, reservations, holds };
}

function makeTable(
  overrides: Partial<MockTable> & {
    id: string;
    capacity: number;
    floorPlanId: string;
    restaurantId?: string;
  },
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
    floorPlan:
      overrides.floorPlan ??
      ({
        id: overrides.floorPlanId,
        restaurantId: overrides.restaurantId ?? 'r-1',
      } as MockTable['floorPlan']),
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
    giftCardRedemptionSnap: null,
    giftCardComplementAmount: null,
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

    it("rejette une table d'un autre restaurant", async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 2 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2, restaurantId: 'r-2' }),
        ],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const error = await service.reallocate('r-1', 't-2').catch((e) => e);
      expect(error).toBeInstanceOf(TableAllocationError);
      expect(error.code).toBe('TABLE_RESTAURANT_MISMATCH');
    });

    it('rejette une table inactive', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 2 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2, isActive: false }),
        ],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const error = await service.reallocate('r-1', 't-2').catch((e) => e);
      expect(error).toBeInstanceOf(TableAllocationError);
      expect(error.code).toBe('TABLE_NOT_ACTIVE');
    });

    it('rejette une table avec minCapacity trop élevé', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 4 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 4, minCapacity: 3 }),
        ],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const error = await service.reallocate('r-1', 't-2').catch((e) => e);
      expect(error).toBeInstanceOf(TableAllocationError);
      expect(error.code).toBe('TABLE_MIN_CAPACITY_TOO_HIGH');
    });

    it('rejette si les temps de réservation sont manquants', async () => {
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 2 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2 }),
        ],
        reservations: [
          makeReservation({
            id: 'r-1',
            tableId: 't-1',
            partySize: 2,
            reservedAt: new Date('2026-07-02T19:00:00Z'),
            startsAt: null as unknown as Date,
            endsAt: null as unknown as Date,
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const error = await service.reallocate('r-1', 't-2').catch((e) => e);
      expect(error).toBeInstanceOf(TableAllocationError);
      expect(error.code).toBe('RESERVATION_TIMES_MISSING');
    });

    it('rejette si la table est déjà occupée sur le créneau', async () => {
      const startsAt = new Date('2026-07-02T19:00:00Z');
      const endsAt = new Date('2026-07-02T21:00:00Z');
      const { prisma } = makeMockPrisma({
        tables: [
          makeTable({ id: 't-1', floorPlanId, capacity: 2 }),
          makeTable({ id: 't-2', floorPlanId, capacity: 2 }),
        ],
        reservations: [
          makeReservation({ id: 'r-1', tableId: 't-1', startsAt, endsAt, partySize: 2 }),
          makeReservation({
            id: 'r-2',
            tableId: 't-2',
            startsAt: new Date('2026-07-02T20:00:00Z'),
            endsAt: new Date('2026-07-02T22:00:00Z'),
            partySize: 2,
          }),
        ],
      });

      const service = new TableAllocationService(prisma);
      const error = await service.reallocate('r-1', 't-2').catch((e) => e);
      expect(error).toBeInstanceOf(TableAllocationError);
      expect(error.code).toBe('TABLE_NOT_AVAILABLE');
    });
  });
});
