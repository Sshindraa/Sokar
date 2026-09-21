/**
 * Backfill durable subscription cadence from Stripe's immutable Price objects.
 *
 * Run after migration 20260921164000_subscription_billing_interval. The dry
 * run is the default; --apply is required for database writes.
 *
 *   pnpm --filter @sokar/api ops:billing-interval-backfill
 *   pnpm --filter @sokar/api ops:billing-interval-backfill -- --apply
 */

import Stripe from 'stripe';
import { billingIntervalFromStripeRecurringInterval } from '../src/modules/billing/billing.service';
import { db } from '../src/shared/db/client';

type BackfillRow = {
  restaurantId: string;
  accountId: string | null;
  priceId: string;
};

function shouldApply(argv: string[]): boolean {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: backfill-billing-interval.ts [--apply]\n');
    process.exit(0);
  }
  return argv.includes('--apply');
}

async function main() {
  const apply = shouldApply(process.argv.slice(2));
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) throw new Error('STRIPE_SECRET_KEY est requis pour lire les prix Stripe.');

  const pending = await db.restaurantBilling.findMany({
    where: {
      subscriptionPriceId: { not: null },
      subscriptionBillingInterval: null,
    },
    select: {
      restaurantId: true,
      subscriptionPriceId: true,
      restaurant: { select: { accountId: true } },
    },
  });
  const rows: BackfillRow[] = pending.flatMap((billing) =>
    billing.subscriptionPriceId
      ? [
          {
            restaurantId: billing.restaurantId,
            accountId: billing.restaurant.accountId,
            priceId: billing.subscriptionPriceId,
          },
        ]
      : [],
  );
  const stripe = new Stripe(secretKey);
  const intervals = new Map<string, 'monthly' | 'annual' | null>();
  let unresolved = 0;
  let changed = 0;

  for (const row of rows) {
    let interval = intervals.get(row.priceId);
    if (interval === undefined) {
      const price = await stripe.prices.retrieve(row.priceId);
      interval = billingIntervalFromStripeRecurringInterval(price.recurring?.interval);
      intervals.set(row.priceId, interval);
    }
    if (!interval) {
      unresolved += 1;
      continue;
    }
    if (!apply) continue;

    await db.$transaction(async (transaction) => {
      await transaction.restaurantBilling.update({
        where: { restaurantId: row.restaurantId },
        data: { subscriptionBillingInterval: interval },
      });
      if (row.accountId) {
        await transaction.restaurantAccountBilling.updateMany({
          where: { accountId: row.accountId, subscriptionBillingInterval: null },
          data: { subscriptionBillingInterval: interval },
        });
      }
    });
    changed += 1;
  }

  process.stdout.write(
    `${apply ? 'Backfill appliqué' : 'Dry-run'} : ${rows.length} projection(s), ${
      rows.length - unresolved
    } résolue(s), ${unresolved} sans cadence, ${changed} modifiée(s).\n`,
  );
  if (unresolved > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
