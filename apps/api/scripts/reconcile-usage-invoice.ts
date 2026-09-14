/**
 * Reconcile an immutable usage ledger slice with a provider invoice export.
 *
 * Usage:
 *   pnpm --filter @sokar/api exec tsx apps/api/scripts/reconcile-usage-invoice.ts \
 *     --file ./private/telnyx-2026-09.csv
 *
 * The command is read-only and fails when a row is not MATCH. Provider
 * rounding must be supplied explicitly with --quantity-tolerance or
 * --cost-tolerance; it is never hidden in a default.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  hashUsageReconciliationReport,
  parseUsageInvoiceImport,
  reconcileUsageInvoice,
  UsageReconciliationImportError,
} from '../src/modules/usage/usage-reconciliation.service.js';

interface Args {
  readonly file: string;
  readonly restaurantId?: string;
  readonly format?: 'csv' | 'json';
  readonly quantityTolerance: string;
  readonly costTolerance: string;
  readonly output?: string;
}

const log = (message: string): void => process.stdout.write(`${message}\n`);

function usage(): void {
  log(`Usage: tsx reconcile-usage-invoice.ts --file <path> [options]

Options:
  --file <path>                 CSV or JSON invoice export (required).
  --format <csv|json>           Override format detection from the extension.
  --restaurant-id <id>         Limit observed usage to one restaurant.
  --quantity-tolerance <n>     Allowed absolute quantity delta (default: 0).
  --cost-tolerance <eur>       Allowed absolute EUR cost delta (default: 0).
  --output <path>              Write the complete report as JSON before evaluating the gate.
  --help, -h                   Show this help.`);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let file: string | undefined;
  let restaurantId: string | undefined;
  let format: Args['format'];
  let quantityTolerance = '0';
  let costTolerance = '0';
  let output: string | undefined;
  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (
      arg === '--file' ||
      arg === '--format' ||
      arg === '--restaurant-id' ||
      arg === '--quantity-tolerance' ||
      arg === '--cost-tolerance' ||
      arg === '--output'
    ) {
      const value = raw[++index];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      if (arg === '--file') file = value;
      else if (arg === '--format') {
        if (value !== 'csv' && value !== 'json') throw new Error('--format must be csv or json');
        format = value;
      } else if (arg === '--restaurant-id') restaurantId = value;
      else if (arg === '--quantity-tolerance') quantityTolerance = value;
      else if (arg === '--cost-tolerance') costTolerance = value;
      else output = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (!file) throw new Error('--file is required');
  return { file, restaurantId, format, quantityTolerance, costTolerance, output };
}

function detectedFormat(file: string, explicit: Args['format']): 'csv' | 'json' {
  if (explicit) return explicit;
  return file.toLowerCase().endsWith('.json') ? 'json' : 'csv';
}

function isNotMatch(status: string): boolean {
  return status !== 'MATCH';
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not defined');
  const path = resolve(process.cwd(), args.file);
  const invoiceRows = parseUsageInvoiceImport(
    await readFile(path, 'utf8'),
    detectedFormat(path, args.format),
  );
  const start = invoiceRows.reduce(
    (min, row) => (row.periodStart < min ? row.periodStart : min),
    invoiceRows[0]!.periodStart,
  );
  const end = invoiceRows.reduce(
    (max, row) => (row.periodEnd > max ? row.periodEnd : max),
    invoiceRows[0]!.periodEnd,
  );
  const prisma = new PrismaClient();
  try {
    const events = await prisma.usageEvent.findMany({
      where: {
        ...(args.restaurantId ? { restaurantId: args.restaurantId } : {}),
        occurredAt: { gte: start, lt: end },
      },
      select: {
        restaurantId: true,
        category: true,
        provider: true,
        unit: true,
        quantity: true,
        estimatedCost: true,
        occurredAt: true,
        metadata: true,
      },
    });
    const report = reconcileUsageInvoice({
      invoiceRows,
      usageEvents: events.map((event) => ({
        restaurantId: event.restaurantId,
        category: event.category,
        provider: event.provider,
        unit: event.unit,
        quantity: event.quantity,
        estimatedCostEur: event.estimatedCost,
        occurredAt: event.occurredAt,
        metadata: event.metadata,
      })),
      quantityTolerance: args.quantityTolerance,
      costToleranceEur: args.costTolerance,
    });
    for (const row of report.rows) {
      log(
        `[${row.status}] ${row.category}/${row.provider}/${row.unit} ${row.periodStart.slice(0, 10)}..${row.periodEnd.slice(0, 10)} observed=${row.observedQuantity} billed=${row.billedQuantity ?? '—'} cost=${row.observedCostEur}/${row.billedCostEur ?? '—'}`,
      );
    }
    const reportHash = hashUsageReconciliationReport({
      report,
      scope: { start: start.toISOString(), end: end.toISOString() },
      restaurantId: args.restaurantId ?? null,
      quantityTolerance: args.quantityTolerance,
      costToleranceEur: args.costTolerance,
    });
    log(`[REPORT_HASH] ${reportHash}`);
    if (args.output) {
      const outputPath = resolve(process.cwd(), args.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            reportHash,
            generatedAt: new Date().toISOString(),
            invoiceFile: path,
            scope: { start: start.toISOString(), end: end.toISOString() },
            restaurantId: args.restaurantId ?? null,
            tolerances: {
              quantity: args.quantityTolerance,
              costEur: args.costTolerance,
            },
            counts: report.counts,
            rows: report.rows,
          },
          null,
          2,
        )}\n`,
      );
      log(`[REPORT] ${outputPath}`);
    }
    log(`[SUMMARY] ${JSON.stringify(report.counts)}`);
    if (report.rows.some((row) => isNotMatch(row.status))) {
      throw new Error('Usage invoice reconciliation failed; review the rows above');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageReconciliationImportError) {
    for (const item of error.issues) {
      console.error(`[ERROR] row=${item.rowNumber} code=${item.code} ${item.message}`);
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
