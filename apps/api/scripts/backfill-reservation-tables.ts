/**
 * Backfill v2 — Attribue un `tableId` et calcule `endsAt` pour les réservations
 * legacy qui n'ont pas encore été reliées au floor plan.
 *
 * Usage :
 *   pnpm --filter @sokar/api exec tsx apps/api/scripts/backfill-reservation-tables.ts [options]
 *
 * Options :
 *   --dry-run                Prévisualise sans écrire en base.
 *   --restaurant-id <id>     Limite le traitement à un restaurant.
 *   --batch-size <n>         Nombre de réservations par lot (défaut : 500).
 *   --force-ends-at          Recalcule systématiquement `endsAt`.
 *   --verbose                Inclut le nom du restaurant dans les logs.
 *   --help, -h               Affiche l'aide.
 *
 * Le script est idempotent : il ignore les réservations dont `tableId` est
 * déjà renseigné. Il est ré-entrant : les erreurs par réservation ne bloquent
 * pas le reste du traitement.
 */

/* eslint-disable no-console */

import { PrismaClient, type Reservation, type Table } from '@prisma/client';
import { TableAllocationService } from '../src/modules/floor-plan/table-allocation.service.js';
import { resolveServiceDurationMinutes } from '../src/modules/floor-plan/floor-plan.types.js';

const ELIGIBLE_STATES: Reservation['state'][] = ['PENDING', 'CONFIRMED', 'SEATED'];

interface Args {
  dryRun: boolean;
  restaurantId?: string;
  batchSize: number;
  forceEndsAt: boolean;
  verbose: boolean;
}

const DEFAULT_BATCH_SIZE = 500;

function printUsage(): void {
  console.log(`Usage: tsx backfill-reservation-tables.ts [options]

Options:
  --dry-run                Preview changes without writing to DB.
  --restaurant-id <id>     Limit backfill to a single restaurant.
  --batch-size <n>         Number of reservations per batch (default: ${DEFAULT_BATCH_SIZE}).
  --force-ends-at          Always recompute endsAt from the service duration.
  --verbose                Include restaurant names in logs.
  --help, -h               Show this help message.`);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);

  if (raw.includes('--help') || raw.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  const result: Args = {
    dryRun: false,
    restaurantId: undefined,
    batchSize: DEFAULT_BATCH_SIZE,
    forceEndsAt: false,
    verbose: false,
  };

  const knownFlags = new Set([
    '--dry-run',
    '--force-ends-at',
    '--verbose',
    '--batch-size',
    '--restaurant-id',
    '--help',
    '-h',
  ]);

  let i = 0;
  while (i < raw.length) {
    const arg = raw[i];

    if (arg === '--dry-run') {
      result.dryRun = true;
      i++;
      continue;
    }

    if (arg === '--force-ends-at') {
      result.forceEndsAt = true;
      i++;
      continue;
    }

    if (arg === '--verbose') {
      result.verbose = true;
      i++;
      continue;
    }

    if (arg === '--batch-size') {
      const value = raw[i + 1];
      if (!value || value.startsWith('-')) {
        console.error('Error: --batch-size requires a positive integer value.');
        printUsage();
        process.exit(1);
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        console.error(`Error: --batch-size must be a positive integer, got "${value}".`);
        printUsage();
        process.exit(1);
      }
      result.batchSize = parsed;
      i += 2;
      continue;
    }

    if (arg === '--restaurant-id') {
      const value = raw[i + 1];
      if (!value || value.startsWith('-')) {
        console.error('Error: --restaurant-id requires a value.');
        printUsage();
        process.exit(1);
      }
      result.restaurantId = value;
      i += 2;
      continue;
    }

    if (arg.startsWith('-')) {
      if (!knownFlags.has(arg)) {
        console.warn(`Warning: unknown flag "${arg}".`);
        process.exit(1);
      }
    }

    console.warn(`Warning: unexpected argument "${arg}".`);
    process.exit(1);
  }

  return result;
}

const args = parseArgs();

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not defined. Set it before running this script.');
  process.exit(1);
}

const prisma = new PrismaClient();
const allocation = new TableAllocationService(prisma);

let totalProcessed = 0;
let totalAllocated = 0;
let totalSkipped = 0;
let totalErrors = 0;

function restaurantLabel(restaurant: { id: string; name: string | null }): string {
  if (args.verbose) {
    return `${restaurant.id} (${restaurant.name ?? 'unknown'})`;
  }
  return restaurant.id;
}

function logProgress(): void {
  console.log(
    `[PROGRESS] Processed: ${totalProcessed}, Allocated: ${totalAllocated}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`,
  );
}

async function main(): Promise<void> {
  const restaurants = await prisma.restaurant.findMany({
    where: args.restaurantId ? { id: args.restaurantId } : undefined,
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  if (restaurants.length === 0) {
    console.log('No restaurants found.');
    return;
  }

  for (const restaurant of restaurants) {
    const floorPlan = await prisma.floorPlan.findUnique({
      where: { restaurantId: restaurant.id },
      include: { tables: { where: { isActive: true }, take: 1 } },
    });

    if (!floorPlan || floorPlan.tables.length === 0) {
      console.log(`[SKIP] Restaurant ${restaurantLabel(restaurant)} : no active floor plan/table.`);
      continue;
    }

    const exposureSettings = await prisma.restaurantExposureSettings.findUnique({
      where: { restaurantId: restaurant.id },
      select: { capacitySpecials: true },
    });

    const serviceDurationMinutes = resolveServiceDurationMinutes(
      exposureSettings?.capacitySpecials ?? {},
    );

    const where = {
      restaurantId: restaurant.id,
      tableId: null,
      startsAt: { not: null },
      state: { in: ELIGIBLE_STATES },
    };

    const pendingCount = await prisma.reservation.count({ where });

    if (pendingCount === 0) {
      console.log(
        `[INFO] Restaurant ${restaurantLabel(restaurant)} : no legacy reservations to backfill.`,
      );
      continue;
    }

    console.log(
      `[INFO] Restaurant ${restaurantLabel(restaurant)} : ${pendingCount} reservation(s) to backfill (service duration: ${serviceDurationMinutes} min, batch size: ${args.batchSize}).`,
    );

    let batchIndex = 0;
    let restaurantProcessed = 0;
    let restaurantAllocated = 0;
    let restaurantSkipped = 0;

    while (true) {
      const reservations = await prisma.reservation.findMany({
        where,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: args.batchSize,
        ...(args.dryRun ? { skip: batchIndex * args.batchSize } : {}),
      });

      if (reservations.length === 0) {
        break;
      }

      for (const res of reservations) {
        totalProcessed++;
        restaurantProcessed++;

        try {
          const startsAt = res.startsAt as Date;
          const shouldRecompute = args.forceEndsAt || !res.endsAt;
          const computedEndsAt = shouldRecompute
            ? new Date(startsAt.getTime() + serviceDurationMinutes * 60_000)
            : null;
          const endsAt = (computedEndsAt ?? res.endsAt) as Date;

          let table: Table | null = null;

          if (args.dryRun) {
            table = await allocation.allocate(
              {
                restaurantId: restaurant.id,
                partySize: res.partySize,
                startsAt,
                endsAt,
              },
              undefined,
              { readOnly: true },
            );

            if (table) {
              console.log(
                `[DRY-RUN] Reservation ${res.id} → table ${table.id} (endsAt: ${endsAt.toISOString()})`,
              );
            } else {
              console.log(`[DRY-RUN] No table available for reservation ${res.id}.`);
            }
          } else {
            await prisma.$transaction(
              async (tx) => {
                table = await allocation.allocate(
                  {
                    restaurantId: restaurant.id,
                    partySize: res.partySize,
                    startsAt,
                    endsAt,
                  },
                  tx,
                );

                if (table) {
                  await tx.reservation.update({
                    where: { id: res.id },
                    data: {
                      tableId: table.id,
                      ...(computedEndsAt ? { endsAt: computedEndsAt } : {}),
                    },
                  });
                } else {
                  console.log(`[SKIP] Reservation ${res.id} : no table available`);
                }
              },
              { maxWait: 5000, timeout: 60000 },
            );
          }

          if (table) {
            totalAllocated++;
            restaurantAllocated++;
          } else {
            totalSkipped++;
            restaurantSkipped++;
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`[ERROR] Reservation ${res.id} : ${message}`);
          totalErrors++;
        }

        if (totalProcessed % 100 === 0) {
          logProgress();
        }
      }

      batchIndex++;

      if (reservations.length < args.batchSize) {
        break;
      }
    }

    if (restaurantProcessed > 0) {
      console.log(
        `[INFO] Restaurant ${restaurantLabel(restaurant)} done — processed: ${restaurantProcessed}, allocated: ${restaurantAllocated}, skipped: ${restaurantSkipped}.`,
      );
    }
  }

  console.log(
    `\n[SUMMARY] Processed: ${totalProcessed}, Allocated: ${totalAllocated}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`,
  );
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal error: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
