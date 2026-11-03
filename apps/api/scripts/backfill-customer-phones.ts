/**
 * Rewrite stored customer phones to E.164 ("06 98 76 54 32" → "+33698765432").
 *
 * Lookups already tolerate both forms, so this is a clean-up, not a fix. The dry run is the
 * default; --apply writes. A remote database also needs --allow-remote. Customers whose target
 * number is already taken are left alone and listed: they are duplicates to merge in the CRM.
 *
 *   pnpm --filter @sokar/api ops:customer-phones-backfill
 *   pnpm --filter @sokar/api ops:customer-phones-backfill -- --apply [--allow-remote]
 */

import { upsertCustomerIdentity } from '../src/modules/customers/customer-crm.service';
import { planPhoneBackfill } from '../src/modules/customers/customer-phone-backfill';
import { db } from '../src/shared/db/client';
import { redisCache } from '../src/shared/redis/client';

function isLocalDatabase(): boolean {
  try {
    const { hostname } = new URL(process.env.DATABASE_URL ?? '');
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  if (apply && !isLocalDatabase() && !argv.includes('--allow-remote')) {
    throw new Error('Base distante : --apply exige --allow-remote (sauvegarde faite).');
  }

  const restaurants = await db.restaurant.findMany({ select: { id: true } });
  let updated = 0;
  let planned = 0;
  let collisions = 0;
  let unparseable = 0;
  let identityConflicts = 0;

  for (const { id: restaurantId } of restaurants) {
    const rows = await db.customer.findMany({
      where: { restaurantId },
      select: { id: true, phone: true, archivedAt: true, mergedIntoId: true },
    });
    const plan = planPhoneBackfill(
      rows.map((row) => ({
        id: row.id,
        phone: row.phone,
        active: row.archivedAt === null && row.mergedIntoId === null,
      })),
    );
    planned += plan.updates.length;
    collisions += plan.collisions.length;
    unparseable += plan.unparseable;
    for (const collision of plan.collisions) {
      process.stdout.write(
        `Collision ${restaurantId} : ${collision.id} (${collision.from}) → ${collision.to}, déjà porté par ${collision.otherId}\n`,
      );
    }
    if (!apply) continue;

    for (const update of plan.updates) {
      await db.customer.update({
        where: { id: update.id, restaurantId },
        data: { phone: update.to },
      });
      const identity = await upsertCustomerIdentity({
        restaurantId,
        customerId: update.id,
        type: 'PHONE',
        value: update.to,
        source: 'BACKFILL',
      });
      if (identity.status === 'conflict') identityConflicts += 1;
      await redisCache.del(
        `customer:${restaurantId}:${update.from}`,
        `customer:${restaurantId}:${update.to}`,
      );
      updated += 1;
    }
  }

  process.stdout.write(
    `${apply ? 'Backfill appliqué' : 'Dry-run'} : ${restaurants.length} restaurant(s), ${planned} numéro(s) à convertir, ${updated} modifié(s), ${collisions} collision(s), ${identityConflicts} conflit(s) d'identité, ${unparseable} non normalisable(s).\n`,
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    // Other Redis clients opened by the shared module keep the event loop alive.
    process.exit(process.exitCode ?? 0);
  });
