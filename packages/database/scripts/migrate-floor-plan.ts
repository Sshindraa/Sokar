import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

type CapacitySpecialEntry = { tables?: number; seats?: number };
type CapacitySpecials = Record<string, CapacitySpecialEntry>;

function extractTotalSeats(capacitySpecials: unknown, maxPartySize: number): number {
  if (!capacitySpecials || typeof capacitySpecials !== 'object') {
    return maxPartySize * 2;
  }

  const specials = capacitySpecials as CapacitySpecials;

  if (specials.default) {
    const seats = Number(specials.default.seats ?? 0);
    if (seats > 0) return seats;
    const tables = Number(specials.default.tables ?? 0);
    if (tables > 0) return tables * 4;
  }

  let totalSeats = 0;
  for (const entry of Object.values(specials)) {
    if (entry && typeof entry === 'object') {
      const seats = Number(entry.seats ?? 0);
      const tables = Number(entry.tables ?? 0);
      totalSeats += seats > 0 ? seats : tables * 4;
    }
  }

  if (totalSeats > 0) return totalSeats;

  return maxPartySize * 2;
}

function generateTables(
  totalSeats: number,
): Array<{ name: string; capacity: number; minCapacity: number }> {
  if (totalSeats <= 20) {
    return [
      { name: 'Table 1', capacity: 2, minCapacity: 1 },
      { name: 'Table 2', capacity: 2, minCapacity: 1 },
      { name: 'Table 3', capacity: 2, minCapacity: 1 },
      { name: 'Table 4', capacity: 2, minCapacity: 1 },
      { name: 'Table 5', capacity: 4, minCapacity: 2 },
      { name: 'Table 6', capacity: 4, minCapacity: 2 },
      { name: 'Table 7', capacity: 6, minCapacity: 4 },
    ];
  }

  const totalTables = Math.max(1, Math.ceil(totalSeats / 4));
  const tablesForTwo = Math.floor(totalTables * 0.4);
  const tablesForFour = Math.floor(totalTables * 0.4);
  const largeTables = totalTables - tablesForTwo - tablesForFour;

  const tables: Array<{ name: string; capacity: number; minCapacity: number }> = [];
  let index = 1;
  for (let i = 0; i < tablesForTwo; i++) {
    tables.push({ name: `Table ${index++}`, capacity: 2, minCapacity: 1 });
  }
  for (let i = 0; i < tablesForFour; i++) {
    tables.push({ name: `Table ${index++}`, capacity: 4, minCapacity: 2 });
  }
  for (let i = 0; i < largeTables; i++) {
    tables.push({ name: `Table ${index++}`, capacity: 6, minCapacity: 4 });
  }
  return tables;
}

async function migrateRestaurant(restaurantId: string) {
  const existing = await prisma.floorPlan.findUnique({
    where: { restaurantId },
    include: { tables: { take: 1 } },
  });

  if (existing && existing.tables.length > 0) {
    process.stdout.write(`Restaurant ${restaurantId}: floor plan already exists, skipping.\n`);
    return;
  }

  const settings = await prisma.restaurantExposureSettings.findUnique({
    where: { restaurantId },
  });

  const maxPartySize = settings?.maxPartySize ?? 12;
  const totalSeats = extractTotalSeats(settings?.capacitySpecials, maxPartySize);
  const tables = generateTables(totalSeats);

  const floorPlan = await prisma.floorPlan.upsert({
    where: { restaurantId },
    update: { name: 'Salle principale' },
    create: { restaurantId, name: 'Salle principale' },
  });

  let section = await prisma.section.findFirst({
    where: { floorPlanId: floorPlan.id, name: 'Salle principale' },
  });
  if (!section) {
    section = await prisma.section.create({
      data: { floorPlanId: floorPlan.id, name: 'Salle principale', position: 0 },
    });
  }

  await prisma.table.createMany({
    data: tables.map((t, i) => ({
      floorPlanId: floorPlan.id,
      sectionId: section.id,
      name: t.name,
      capacity: t.capacity,
      minCapacity: t.minCapacity,
      positionX: i,
      positionY: 0,
    })),
  });

  process.stdout.write(
    `Restaurant ${restaurantId}: created ${tables.length} tables (${totalSeats} seats).\n`,
  );
}

async function main() {
  const restaurants = await prisma.restaurant.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  process.stdout.write(`Migrating ${restaurants.length} restaurants...\n`);

  for (const restaurant of restaurants) {
    await migrateRestaurant(restaurant.id);
  }

  process.stdout.write('Floor plan migration complete.\n');
}

main()
  .catch((err) => {
    process.stderr.write(String(err) + '\n');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
