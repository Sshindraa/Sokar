/**
 * Backfill M03 CRM projections (identities, reservation timeline, metrics).
 *
 * Usage:
 *   pnpm --filter @sokar/api exec tsx apps/api/scripts/backfill-customer-crm.ts --dry-run
 *   pnpm --filter @sokar/api exec tsx apps/api/scripts/backfill-customer-crm.ts --apply
 *
 * The script is resumable: it prints the last processed customer id. Pass it
 * back with --after-id after an interrupted run. It is deliberately dry-run
 * by default; --apply is required before any write.
 */

/* eslint-disable no-console */

import { PrismaClient, type ReservationState } from '@prisma/client';
import {
  appendCustomerTimelineEvent,
  buildCustomerTimelineDedupeKey,
  rebuildCustomerMetricSnapshot,
  upsertCustomerIdentity,
} from '../src/modules/customers/customer-crm.service.js';

interface Args {
  apply: boolean;
  restaurantId?: string;
  batchSize: number;
  afterId?: string;
}

const DEFAULT_BATCH_SIZE = 250;
const log = (message: string): void => process.stdout.write(`${message}\n`);

function usage(): void {
  log(`Usage: tsx backfill-customer-crm.ts [options]

Options:
  --dry-run                Preview only (default).
  --apply                  Write identities, timeline events and metrics.
  --restaurant-id <id>     Limit processing to one restaurant.
  --batch-size <n>         Customers per batch (default: ${DEFAULT_BATCH_SIZE}).
  --after-id <id>          Resume after a customer id printed by a prior run.
  --help, -h               Show this help.`);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  if (raw.includes('--help') || raw.includes('-h')) {
    usage();
    process.exit(0);
  }

  const result: Args = { apply: false, batchSize: DEFAULT_BATCH_SIZE };
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--apply') {
      result.apply = true;
      continue;
    }
    if (arg === '--dry-run') continue;
    if (arg === '--restaurant-id' || arg === '--batch-size' || arg === '--after-id') {
      const value = raw[++index];
      if (!value || value.startsWith('-')) {
        console.error(`${arg} requires a value.`);
        usage();
        process.exit(1);
      }
      if (arg === '--restaurant-id') result.restaurantId = value;
      if (arg === '--after-id') result.afterId = value;
      if (arg === '--batch-size') {
        const batchSize = Number(value);
        if (!Number.isInteger(batchSize) || batchSize <= 0) {
          console.error('--batch-size must be a positive integer.');
          process.exit(1);
        }
        result.batchSize = batchSize;
      }
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }
  return result;
}

const args = parseArgs();
const prisma = new PrismaClient();

function lifecycleEvent(
  state: ReservationState | string,
): 'RESERVATION_CANCELLED' | 'RESERVATION_HONORED' | 'RESERVATION_NO_SHOW' | null {
  if (state === 'CANCELLED') return 'RESERVATION_CANCELLED';
  if (state === 'HONORED') return 'RESERVATION_HONORED';
  if (state === 'NO_SHOW') return 'RESERVATION_NO_SHOW';
  return null;
}

async function processCustomer(customer: {
  id: string;
  restaurantId: string;
  phone: string;
  emailNormalized: string | null;
}): Promise<{ identities: number; conflicts: number; timeline: number }> {
  let identities = 0;
  let conflicts = 0;
  let timeline = 0;

  if (args.apply) {
    const phone = await upsertCustomerIdentity(
      {
        restaurantId: customer.restaurantId,
        customerId: customer.id,
        type: 'PHONE',
        value: customer.phone,
        source: 'IMPORT',
      },
      prisma,
    );
    if (phone.status === 'conflict') conflicts++;
    else identities++;

    if (customer.emailNormalized) {
      const email = await upsertCustomerIdentity(
        {
          restaurantId: customer.restaurantId,
          customerId: customer.id,
          type: 'EMAIL',
          value: customer.emailNormalized,
          source: 'IMPORT',
        },
        prisma,
      );
      if (email.status === 'conflict') conflicts++;
      else identities++;
    }
  }

  const reservations = await prisma.reservation.findMany({
    where: { restaurantId: customer.restaurantId, customerId: customer.id },
    select: {
      id: true,
      state: true,
      status: true,
      reservedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  for (const reservation of reservations) {
    const events: Array<{
      type:
        | 'RESERVATION_CREATED'
        | 'RESERVATION_CANCELLED'
        | 'RESERVATION_HONORED'
        | 'RESERVATION_NO_SHOW';
      summaryCode: string;
    }> = [{ type: 'RESERVATION_CREATED', summaryCode: 'reservation.created' }];
    const terminal =
      lifecycleEvent(String(reservation.state)) ?? lifecycleEvent(String(reservation.status));
    if (terminal)
      events.push({
        type: terminal,
        summaryCode: `reservation.${terminal.slice('RESERVATION_'.length).toLowerCase()}`,
      });

    for (const event of events) {
      if (!args.apply) {
        timeline++;
        continue;
      }
      const result = await appendCustomerTimelineEvent(
        {
          restaurantId: customer.restaurantId,
          customerId: customer.id,
          eventType: event.type,
          sourceType: 'reservation',
          sourceId: reservation.id,
          dedupeKey: buildCustomerTimelineDedupeKey({
            restaurantId: customer.restaurantId,
            customerId: customer.id,
            eventType: event.type,
            sourceType: 'reservation',
            sourceId: reservation.id,
          }),
          occurredAt:
            event.type === 'RESERVATION_CREATED' ? reservation.createdAt : reservation.reservedAt,
          summaryCode: event.summaryCode,
        },
        prisma,
      );
      if (result.created) timeline++;
    }
  }

  if (args.apply) {
    await rebuildCustomerMetricSnapshot(
      { restaurantId: customer.restaurantId, customerId: customer.id },
      prisma,
    );
  }
  return { identities, conflicts, timeline };
}

async function main(): Promise<void> {
  let cursor = args.afterId;
  let processed = 0;
  let identities = 0;
  let conflicts = 0;
  let timeline = 0;

  while (true) {
    const customers = await prisma.customer.findMany({
      where: {
        ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: args.batchSize,
      select: { id: true, restaurantId: true, phone: true, emailNormalized: true },
    });
    if (customers.length === 0) break;

    for (const customer of customers) {
      try {
        const result = await processCustomer(customer);
        identities += result.identities;
        conflicts += result.conflicts;
        timeline += result.timeline;
        processed++;
        cursor = customer.id;
      } catch (error) {
        console.error(
          `[ERROR] customer=${customer.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        cursor = customer.id;
      }
    }
    log(
      `[PROGRESS] mode=${args.apply ? 'apply' : 'dry-run'} processed=${processed} identities=${identities} conflicts=${conflicts} timeline=${timeline} resumeAfterId=${cursor ?? 'none'}`,
    );
    if (customers.length < args.batchSize) break;
  }

  log(
    `[DONE] mode=${args.apply ? 'apply' : 'dry-run'} processed=${processed} identities=${identities} conflicts=${conflicts} timeline=${timeline} resumeAfterId=${cursor ?? 'none'}`,
  );
}

main()
  .catch((error) => {
    console.error('[FAILED]', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
