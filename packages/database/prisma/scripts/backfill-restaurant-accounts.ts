import { PrismaClient } from '@prisma/client';

type Options = {
  apply: boolean;
  limit?: number;
};

function parseOptions(argv: string[]): Options {
  const apply = argv.includes('--apply');
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const limitValue = limitArg ? Number.parseInt(limitArg.slice('--limit='.length), 10) : undefined;
  const limit = Number.isInteger(limitValue) && (limitValue as number) > 0 ? limitValue : undefined;
  return { apply, limit };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const db = new PrismaClient();

  try {
    const restaurants = await db.restaurant.findMany({
      where: { accountId: null },
      orderBy: { createdAt: 'asc' },
      ...(options.limit ? { take: options.limit } : {}),
      select: { id: true, name: true },
    });

    // CLI output is the audit trail for the dry-run/apply decision.
    // eslint-disable-next-line no-console
    console.log(
      `[multisite-backfill] mode=${options.apply ? 'apply' : 'dry-run'} candidates=${restaurants.length}`,
    );

    if (!options.apply || restaurants.length === 0) return;

    let migrated = 0;
    for (const restaurant of restaurants) {
      await db.$transaction(async (tx) => {
        const account = await tx.restaurantAccount.upsert({
          where: { clerkOrganizationId: restaurant.id },
          create: { clerkOrganizationId: restaurant.id, name: restaurant.name },
          update: {},
        });

        await tx.restaurant.update({
          where: { id: restaurant.id },
          data: { accountId: account.id, isPrimary: true, siteStatus: 'ACTIVE' },
        });
      });
      migrated += 1;
    }

    // eslint-disable-next-line no-console
    console.log(`[multisite-backfill] migrated=${migrated}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[multisite-backfill] failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
