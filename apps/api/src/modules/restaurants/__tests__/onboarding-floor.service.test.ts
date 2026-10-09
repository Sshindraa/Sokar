import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CapacityAwareAvailabilityService } from '../../floor-plan/availability-capacity-aware.service.js';
import {
  applyQuickFloorSetup,
  loadFloorStats,
  QuickFloorSetupSchema,
} from '../onboarding-floor.service';

type ExistingTable = {
  id: string;
  name: string;
  capacity: number;
  positionY?: number | null;
  height?: number | null;
};

function makePrisma(existing: ExistingTable[], usedTableIds: string[] = []) {
  const table = {
    findMany: vi.fn(async (args: { where: { isActive?: boolean } }) =>
      args.where.isActive
        ? existing.map((row) => ({ positionY: null, height: null, ...row }))
        : existing.map((row) => ({ name: row.name })),
    ),
    createMany: vi.fn(async () => ({ count: 0 })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    updateMany: vi.fn(async () => ({ count: 0 })),
    aggregate: vi.fn(async () => ({
      _count: { _all: 3 },
      _sum: { capacity: 12 },
      _max: { capacity: 6 },
    })),
  };
  const used = usedTableIds.map((tableId) => ({ tableId }));
  const tx = {
    table,
    reservation: { findMany: vi.fn(async () => used) },
    agenticHold: { findMany: vi.fn(async () => []) },
    tableCombinationMember: { findMany: vi.fn(async () => []) },
  };
  const prisma = {
    table,
    floorPlan: { findFirst: vi.fn(async () => ({ id: 'plan-1' })) },
    $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  return { prisma: prisma as never, table };
}

describe('QuickFloorSetupSchema', () => {
  it('refuse une salle sans table', () => {
    expect(QuickFloorSetupSchema.safeParse({ tables: [{ capacity: 2, count: 0 }] }).success).toBe(
      false,
    );
  });

  it('refuse deux lignes pour la même taille', () => {
    const result = QuickFloorSetupSchema.safeParse({
      tables: [
        { capacity: 4, count: 2 },
        { capacity: 4, count: 1 },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('refuse une table de plus de 20 couverts', () => {
    expect(QuickFloorSetupSchema.safeParse({ tables: [{ capacity: 21, count: 1 }] }).success).toBe(
      false,
    );
  });

  it('accepte une répartition ordinaire', () => {
    const result = QuickFloorSetupSchema.safeParse({
      tables: [
        { capacity: 2, count: 4 },
        { capacity: 4, count: 6 },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe('applyQuickFloorSetup', () => {
  beforeEach(() => {
    vi.spyOn(CapacityAwareAvailabilityService, 'invalidateAvailability').mockResolvedValue();
  });

  it('crée les tables d’une salle vide, nommées et rangées en grille', async () => {
    const { prisma, table } = makePrisma([]);

    const result = await applyQuickFloorSetup(prisma, 'resto-1', {
      tables: [
        { capacity: 2, count: 2 },
        { capacity: 4, count: 1 },
      ],
    });

    expect(result).toMatchObject({ created: 3, deleted: 0, deactivated: 0 });
    const created = (table.createMany.mock.calls[0] as unknown as [{ data: unknown[] }])[0].data;
    expect(created).toEqual([
      expect.objectContaining({ name: 'T1', capacity: 2, positionX: 80, positionY: 80 }),
      expect.objectContaining({ name: 'T2', capacity: 2, positionX: 240, positionY: 80 }),
      expect.objectContaining({ name: 'T3', capacity: 4, positionX: 400, positionY: 80 }),
    ]);
    expect(CapacityAwareAvailabilityService.invalidateAvailability).toHaveBeenCalledWith('resto-1');
  });

  it('numérote à la suite des tables existantes et les place sous elles', async () => {
    const { prisma, table } = makePrisma([
      { id: 'a', name: 'T7', capacity: 2, positionY: 300, height: 76 },
    ]);

    await applyQuickFloorSetup(prisma, 'resto-1', {
      tables: [
        { capacity: 2, count: 1 },
        { capacity: 6, count: 1 },
      ],
    });

    const created = (table.createMany.mock.calls[0] as unknown as [{ data: unknown[] }])[0].data;
    expect(created).toEqual([expect.objectContaining({ name: 'T8', capacity: 6, positionY: 446 })]);
  });

  it('retire les tables en trop : supprime l’inutilisée, désactive celle qui a des réservations', async () => {
    const { prisma, table } = makePrisma(
      [
        { id: 'old', name: 'T1', capacity: 2 },
        { id: 'booked', name: 'T2', capacity: 2 },
        { id: 'free', name: 'T3', capacity: 2 },
      ],
      ['booked'],
    );

    const result = await applyQuickFloorSetup(prisma, 'resto-1', {
      tables: [{ capacity: 2, count: 1 }],
    });

    expect(result).toMatchObject({ created: 0, deleted: 1, deactivated: 1 });
    expect(table.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['free'] } } });
    expect(table.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['booked'] } },
      data: { isActive: false },
    });
    expect(table.createMany).not.toHaveBeenCalled();
  });

  it('traite une taille absente de la demande comme ramenée à zéro', async () => {
    const { prisma, table } = makePrisma([
      { id: 'six', name: 'T1', capacity: 6 },
      { id: 'two', name: 'T2', capacity: 2 },
    ]);

    await applyQuickFloorSetup(prisma, 'resto-1', { tables: [{ capacity: 2, count: 1 }] });

    expect(table.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['six'] } } });
  });

  it('renvoie les effectifs relus après modification', async () => {
    const { prisma } = makePrisma([]);
    const result = await applyQuickFloorSetup(prisma, 'resto-1', {
      tables: [{ capacity: 4, count: 3 }],
    });
    expect(result.stats).toEqual({ tableCount: 3, seatCount: 12, largestTableCapacity: 6 });
  });
});

describe('loadFloorStats', () => {
  it('compte les tables actives des plans actifs', async () => {
    const { prisma, table } = makePrisma([]);
    await loadFloorStats(prisma, 'resto-1');
    expect(table.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true, floorPlan: { restaurantId: 'resto-1', isActive: true } },
      }),
    );
  });

  it('renvoie zéro partout pour une salle vide', async () => {
    const { prisma, table } = makePrisma([]);
    table.aggregate.mockResolvedValueOnce({
      _count: { _all: 0 },
      _sum: { capacity: null as never },
      _max: { capacity: null as never },
    });
    await expect(loadFloorStats(prisma, 'resto-1')).resolves.toEqual({
      tableCount: 0,
      seatCount: 0,
      largestTableCapacity: 0,
    });
  });
});
