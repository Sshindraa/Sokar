import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { CapacityAwareAvailabilityService } from '../floor-plan/availability-capacity-aware.service.js';
import { FloorPlanService } from '../floor-plan/floor-plan.service.js';
import type { FloorStats } from './onboarding.service';

export const MAX_TABLE_CAPACITY = 20;
export const MAX_TABLES_PER_RESTAURANT = 200;

/**
 * Création rapide de la salle pendant l'onboarding : « N tables de C couverts ».
 * Le plan détaillé (position, sections, combinaisons) reste dans l'éditeur du plan de salle.
 */
export const QuickFloorSetupSchema = z
  .object({
    tables: z
      .array(
        z.object({
          capacity: z.number().int().min(1).max(MAX_TABLE_CAPACITY),
          count: z.number().int().min(0).max(MAX_TABLES_PER_RESTAURANT),
        }),
      )
      .max(MAX_TABLE_CAPACITY),
  })
  .superRefine((value, ctx) => {
    const capacities = value.tables.map((row) => row.capacity);
    if (new Set(capacities).size !== capacities.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Chaque taille de table ne peut apparaître qu’une fois',
      });
    }
    const total = value.tables.reduce((sum, row) => sum + row.count, 0);
    if (total < 1) {
      ctx.addIssue({ code: 'custom', message: 'Ajoutez au moins une table' });
    }
    if (total > MAX_TABLES_PER_RESTAURANT) {
      ctx.addIssue({ code: 'custom', message: `Maximum ${MAX_TABLES_PER_RESTAURANT} tables` });
    }
  });

export type QuickFloorSetupInput = z.infer<typeof QuickFloorSetupSchema>;

export type QuickFloorSetupResult = {
  created: number;
  deleted: number;
  deactivated: number;
  stats: FloorStats;
};

const GRID_ORIGIN = 80;
const GRID_STEP_X = 160;
const GRID_STEP_Y = 140;
const GRID_COLUMNS = 8;

/** Même périmètre que la disponibilité : tables actives des plans de salle actifs. */
export async function loadFloorStats(
  prisma: Pick<PrismaClient, 'table'>,
  restaurantId: string,
): Promise<FloorStats> {
  const aggregate = await prisma.table.aggregate({
    where: { isActive: true, floorPlan: { restaurantId, isActive: true } },
    _count: { _all: true },
    _sum: { capacity: true },
    _max: { capacity: true },
  });
  return {
    tableCount: aggregate._count._all,
    seatCount: aggregate._sum.capacity ?? 0,
    largestTableCapacity: aggregate._max.capacity ?? 0,
  };
}

function nextTableNumber(names: string[]): number {
  let highest = 0;
  for (const name of names) {
    const match = /^T(\d+)$/.exec(name.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return Math.max(highest, names.length) + 1;
}

/** Les nouvelles tables se rangent en grille sous les tables déjà placées, sans les recouvrir. */
function gridPosition(index: number, startY: number): { positionX: number; positionY: number } {
  return {
    positionX: GRID_ORIGIN + (index % GRID_COLUMNS) * GRID_STEP_X,
    positionY: startY + Math.floor(index / GRID_COLUMNS) * GRID_STEP_Y,
  };
}

/**
 * Aligne les tables actives du plan par défaut sur les effectifs demandés, taille par taille.
 * - Une table sans réservation ni blocage est supprimée ; sinon elle est désactivée, pour que
 *   l'historique garde sa table et que la disponibilité arrête de la compter.
 * - Les tables ajoutées reçoivent une position en grille, visibles tout de suite dans le plan.
 */
export async function applyQuickFloorSetup(
  prisma: PrismaClient,
  restaurantId: string,
  input: QuickFloorSetupInput,
): Promise<QuickFloorSetupResult> {
  const floorPlan = await new FloorPlanService(prisma).getDefaultFloorPlan(restaurantId);
  const wanted = new Map(input.tables.map((row) => [row.capacity, row.count]));

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.table.findMany({
      where: { floorPlanId: floorPlan.id, isActive: true },
      select: { id: true, name: true, capacity: true, positionY: true, height: true },
      orderBy: { createdAt: 'asc' },
    });
    const allNames = (
      await tx.table.findMany({ where: { floorPlanId: floorPlan.id }, select: { name: true } })
    ).map((row) => row.name);

    const byCapacity = new Map<number, typeof existing>();
    for (const table of existing) {
      byCapacity.set(table.capacity, [...(byCapacity.get(table.capacity) ?? []), table]);
    }
    // Une taille absente de la demande est une taille ramenée à zéro.
    const capacities = new Set([...byCapacity.keys(), ...wanted.keys()]);

    const toCreate: Prisma.TableCreateManyInput[] = [];
    const toRemove: string[] = [];
    let number = nextTableNumber(allNames);
    const lowestEdge = existing.reduce(
      (edge, table) => Math.max(edge, (table.positionY ?? 0) + (table.height ?? 0)),
      0,
    );
    const startY = existing.some((table) => table.positionY !== null)
      ? Math.max(GRID_ORIGIN, lowestEdge + GRID_STEP_Y / 2)
      : GRID_ORIGIN;

    for (const capacity of [...capacities].sort((a, b) => a - b)) {
      const current = byCapacity.get(capacity) ?? [];
      const target = wanted.get(capacity) ?? 0;
      if (target > current.length) {
        for (let i = current.length; i < target; i += 1) {
          toCreate.push({
            floorPlanId: floorPlan.id,
            name: `T${number}`,
            capacity,
            minCapacity: 1,
            shape: 'rect',
            ...gridPosition(toCreate.length, startY),
          });
          number += 1;
        }
      } else if (target < current.length) {
        // On retire d'abord les tables les plus récentes : ce sont celles que l'on vient d'ajouter.
        toRemove.push(...current.slice(target).map((table) => table.id));
      }
    }

    let deleted = 0;
    let deactivated = 0;
    if (toRemove.length > 0) {
      const [reservations, holds, combinations] = await Promise.all([
        tx.reservation.findMany({
          where: { restaurantId, tableId: { in: toRemove } },
          select: { tableId: true },
          distinct: ['tableId'],
        }),
        tx.agenticHold.findMany({
          where: { restaurantId, tableId: { in: toRemove } },
          select: { tableId: true },
          distinct: ['tableId'],
        }),
        tx.tableCombinationMember.findMany({
          where: { tableId: { in: toRemove } },
          select: { tableId: true },
          distinct: ['tableId'],
        }),
      ]);
      const used = new Set(
        [...reservations, ...holds, ...combinations]
          .map((row) => row.tableId)
          .filter((id): id is string => Boolean(id)),
      );
      const removable = toRemove.filter((id) => !used.has(id));
      const retained = toRemove.filter((id) => used.has(id));
      if (removable.length > 0) {
        await tx.table.deleteMany({ where: { id: { in: removable } } });
        deleted = removable.length;
      }
      if (retained.length > 0) {
        await tx.table.updateMany({ where: { id: { in: retained } }, data: { isActive: false } });
        deactivated = retained.length;
      }
    }
    if (toCreate.length > 0) {
      await tx.table.createMany({ data: toCreate });
    }

    return { created: toCreate.length, deleted, deactivated };
  });

  await CapacityAwareAvailabilityService.invalidateAvailability(restaurantId);

  return { ...result, stats: await loadFloorStats(prisma, restaurantId) };
}

/** Effectifs actuels par taille de table, dans le plan par défaut, pour préremplir l'écran. */
export async function loadFloorSummary(
  prisma: Pick<PrismaClient, 'table'>,
  restaurantId: string,
): Promise<Array<{ capacity: number; count: number }>> {
  const groups = await prisma.table.groupBy({
    by: ['capacity'],
    where: { isActive: true, floorPlan: { restaurantId, isActive: true, isDefault: true } },
    _count: { _all: true },
    orderBy: { capacity: 'asc' },
  });
  return groups.map((group) => ({ capacity: group.capacity, count: group._count._all }));
}
