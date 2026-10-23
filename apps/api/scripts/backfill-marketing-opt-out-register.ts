/**
 * Backfill the marketing opt-out register from withdrawals recorded before it existed.
 *
 * Usage:
 *   MARKETING_OPTOUT_HASH_SECRET=... pnpm --filter @sokar/api exec tsx scripts/backfill-marketing-opt-out-register.ts --dry-run
 *   MARKETING_OPTOUT_HASH_SECRET=... pnpm --filter @sokar/api exec tsx scripts/backfill-marketing-opt-out-register.ts --apply
 *
 * Sources: `MarketingPermission` in OPTED_OUT, and `MarketingSuppression` of reason COMPLAINED (a
 * spam complaint). Hard bounces are not oppositions. The register needs the server key, so this cannot
 * be done in SQL. Dry-run by default; the output only contains counts, never an address or a phone
 * number. Re-running is safe: an entry is refreshed, never duplicated.
 */

import { PrismaClient } from '@prisma/client';
import {
  isMarketingOptOutRegisterConfigured,
  registerMarketingOptOut,
} from '../src/modules/marketing/marketing-opt-out.service.js';

interface Args {
  apply: boolean;
  restaurantId?: string;
  batchSize: number;
}

const DEFAULT_BATCH_SIZE = 250;
const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  if (raw.includes('--help') || raw.includes('-h')) {
    log(
      `Usage: tsx backfill-marketing-opt-out-register.ts [--dry-run | --apply] [--restaurant-id <id>] [--batch-size <n>]`,
    );
    process.exit(0);
  }
  const result: Args = { apply: false, batchSize: DEFAULT_BATCH_SIZE };
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--apply') result.apply = true;
    else if (arg === '--dry-run') continue;
    else if (arg === '--restaurant-id' || arg === '--batch-size') {
      const value = raw[++index];
      if (!value || value.startsWith('-')) {
        console.error(`${arg} requires a value.`);
        process.exit(1);
      }
      if (arg === '--restaurant-id') result.restaurantId = value;
      else {
        const batchSize = Number(value);
        if (!Number.isInteger(batchSize) || batchSize <= 0) {
          console.error('--batch-size must be a positive integer.');
          process.exit(1);
        }
        result.batchSize = batchSize;
      }
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }
  return result;
}

const args = parseArgs();
const prisma = new PrismaClient();

type Counts = { seen: number; registered: number; skippedNoAddress: number };

async function backfillPermissions(): Promise<Counts> {
  const counts: Counts = { seen: 0, registered: 0, skippedNoAddress: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.marketingPermission.findMany({
      where: {
        status: 'OPTED_OUT',
        ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
      },
      orderBy: { id: 'asc' },
      take: args.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        restaurantId: true,
        channel: true,
        source: true,
        withdrawnAt: true,
        updatedAt: true,
        customer: { select: { phone: true, emailNormalized: true } },
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counts.seen++;
      const address = row.channel === 'EMAIL' ? row.customer.emailNormalized : row.customer.phone;
      if (!address) {
        counts.skippedNoAddress++;
        continue;
      }
      if (args.apply) {
        const outcome = await registerMarketingOptOut(
          {
            restaurantId: row.restaurantId,
            channel: row.channel,
            address,
            reason: row.source.startsWith('UNSUBSCRIBE') ? 'UNSUBSCRIBE' : 'MANUAL',
            source: row.source,
            occurredAt: row.withdrawnAt ?? row.updatedAt,
          },
          prisma,
        );
        if (outcome === 'REGISTERED') counts.registered++;
        else counts.skippedNoAddress++;
      } else {
        counts.registered++;
      }
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < args.batchSize) break;
  }
  return counts;
}

async function backfillComplaints(): Promise<Counts> {
  const counts: Counts = { seen: 0, registered: 0, skippedNoAddress: 0 };
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.marketingSuppression.findMany({
      where: {
        reason: 'COMPLAINED',
        channel: { not: null },
        ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
      },
      orderBy: { id: 'asc' },
      take: args.batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        restaurantId: true,
        channel: true,
        source: true,
        createdAt: true,
        customer: { select: { phone: true, emailNormalized: true } },
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      counts.seen++;
      const channel = row.channel;
      const address = channel === 'EMAIL' ? row.customer.emailNormalized : row.customer.phone;
      if (!channel || !address) {
        counts.skippedNoAddress++;
        continue;
      }
      if (args.apply) {
        const outcome = await registerMarketingOptOut(
          {
            restaurantId: row.restaurantId,
            channel,
            address,
            reason: 'COMPLAINT',
            source: row.source,
            occurredAt: row.createdAt,
          },
          prisma,
        );
        if (outcome === 'REGISTERED') counts.registered++;
        else counts.skippedNoAddress++;
      } else {
        counts.registered++;
      }
    }
    cursor = rows[rows.length - 1].id;
    if (rows.length < args.batchSize) break;
  }
  return counts;
}

async function main(): Promise<void> {
  if (!isMarketingOptOutRegisterConfigured()) {
    throw new Error('MARKETING_OPTOUT_HASH_SECRET is missing or shorter than 32 characters.');
  }
  const permissions = await backfillPermissions();
  const complaints = await backfillComplaints();
  const verb = args.apply ? 'registered' : 'would register';
  log(
    `[DONE] mode=${args.apply ? 'apply' : 'dry-run'} withdrawals: seen=${permissions.seen} ${verb}=${permissions.registered} noAddress=${permissions.skippedNoAddress}; complaints: seen=${complaints.seen} ${verb}=${complaints.registered} noAddress=${complaints.skippedNoAddress}`,
  );
}

main()
  .catch((error) => {
    console.error('[FAILED]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
