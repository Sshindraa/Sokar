/**
 * Reconcile Sokar billing projections with the live Stripe subscriptions.
 *
 * Repairs records left behind by the same-second webhook race found in the 21/10/2026 audit
 * (a trial ended early stayed `trialing` while Stripe was `active`). See
 * docs/runbooks/stripe-billing.md, section « Réparer un dossier décalé ».
 *
 * Usage:
 *   pnpm --filter @sokar/api exec tsx scripts/reconcile-stripe-billing.ts --dry-run
 *   pnpm --filter @sokar/api exec tsx scripts/reconcile-stripe-billing.ts --apply
 *   pnpm --filter @sokar/api exec tsx scripts/reconcile-stripe-billing.ts --restaurant-id <id> --apply
 *
 * Dry-run by default: --apply is required before any write. Applying re-projects the live
 * subscription without moving the webhook checkpoint. Output carries identifiers and statuses
 * only, never a name, e-mail or amount.
 */

// Loads the API environment before modules that connect to Redis at import time.
import '../src/env.js';
import { reconcileBillingFromStripe } from '../src/modules/billing/billing.service.js';

interface Args {
  apply: boolean;
  restaurantId?: string;
}

const log = (message: string): void => process.stdout.write(`${message}\n`);

function usage(): void {
  log(`Usage: tsx reconcile-stripe-billing.ts [options]

Options:
  --dry-run                Preview only (default).
  --apply                  Re-project the live Stripe status on records that differ.
  --restaurant-id <id>     Limit to one restaurant.
  --help, -h               Show this help.`);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  if (raw.includes('--help') || raw.includes('-h')) {
    usage();
    process.exit(0);
  }
  const result: Args = { apply: false };
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (arg === '--dry-run') continue;
    if (arg === '--restaurant-id') {
      const value = raw[index + 1];
      if (!value || value.startsWith('--')) throw new Error('--restaurant-id requires a value');
      result.restaurantId = value;
      index++;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

async function main(): Promise<void> {
  const args = parseArgs();
  log(
    `mode: ${args.apply ? 'APPLY' : 'dry-run'}${args.restaurantId ? ` (restaurant ${args.restaurantId})` : ''}`,
  );
  const results = await reconcileBillingFromStripe(args);
  let changed = 0;
  for (const result of results) {
    if (!result.changed) continue;
    changed++;
    log(
      `${result.applied ? 'réparé' : 'écart'}  restaurant=${result.restaurantId} subscription=${result.subscriptionId} sokar=${result.storedStatus ?? 'null'} stripe=${result.liveStatus}`,
    );
  }
  log(
    `dossiers lus: ${results.length}, écarts: ${changed}${args.apply ? `, réparés: ${changed}` : ''}`,
  );
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
