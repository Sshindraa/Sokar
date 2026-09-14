/**
 * Import validated provider tariffs into the versioned UsageTariff catalog.
 *
 * Usage:
 *   pnpm --filter @sokar/api exec tsx apps/api/scripts/import-usage-tariffs.ts \
 *     --file ./tariffs.csv --dry-run
 *   pnpm --filter @sokar/api exec tsx apps/api/scripts/import-usage-tariffs.ts \
 *     --file ./tariffs.csv --apply
 *
 * The input must contain the columns documented in the usage costing runbook.
 * It is dry-run by default. --apply only inserts rows that pass validation;
 * identical rows are skipped and conflicting/overlapping rows abort the run.
 */

/* eslint-disable no-console */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  parseUsageTariffImport,
  planUsageTariffImport,
  toUsageTariffCreateData,
  UsageTariffImportError,
} from '../src/modules/usage/usage-tariff-import.service.js';

interface Args {
  readonly file: string;
  readonly apply: boolean;
  readonly format?: 'csv' | 'json';
}

const log = (message: string): void => process.stdout.write(`${message}\n`);

function usage(): void {
  log(`Usage: tsx import-usage-tariffs.ts --file <path> [options]

Options:
  --file <path>           CSV or JSON tariff file (required).
  --format <csv|json>     Override format detection from the file extension.
  --dry-run               Validate and preview only (default).
  --apply                 Insert validated tariffs into the local database.
  --help, -h              Show this help.`);
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let file: string | undefined;
  let apply = false;
  let format: Args['format'];

  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--dry-run') continue;
    if (arg === '--file' || arg === '--format') {
      const value = raw[++index];
      if (!value || value.startsWith('-')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--file') file = value;
      else if (value === 'csv' || value === 'json') format = value;
      else throw new Error('--format must be csv or json');
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!file) throw new Error('--file is required');
  return { file, apply, format };
}

function detectedFormat(file: string, explicit: Args['format']): 'csv' | 'json' {
  if (explicit) return explicit;
  return file.toLowerCase().endsWith('.json') ? 'json' : 'csv';
}

async function main(): Promise<void> {
  const args = parseArgs();
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not defined');

  const path = resolve(process.cwd(), args.file);
  const format = detectedFormat(path, args.format);
  const rows = parseUsageTariffImport(await readFile(path, 'utf8'), format);
  const prisma = new PrismaClient();

  try {
    const existing = await prisma.usageTariff.findMany({
      orderBy: [{ category: 'asc' }, { provider: 'asc' }, { unit: 'asc' }, { version: 'asc' }],
    });
    const plan = planUsageTariffImport(rows, existing);
    for (const item of plan.issues) {
      console.error(`[ERROR] row=${item.rowNumber} code=${item.code} ${item.message}`);
    }
    log(
      `[PLAN] format=${format} rows=${rows.length} inserts=${plan.inserts.length} skips=${plan.skips.length} issues=${plan.issues.length}`,
    );
    if (plan.issues.length > 0) {
      throw new Error('Tariff import aborted; fix the input and rerun the dry-run');
    }
    if (!args.apply || plan.inserts.length === 0) {
      log(
        args.apply
          ? '[DONE] No new tariff row to insert.'
          : '[DRY-RUN] No database write performed.',
      );
      return;
    }

    const inserted = await prisma.$transaction(async (tx) => {
      for (const row of plan.inserts) {
        await tx.usageTariff.create({ data: toUsageTariffCreateData(row) });
      }
      return plan.inserts.length;
    });
    log(`[DONE] inserted=${inserted} skipped=${plan.skips.length}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  if (error instanceof UsageTariffImportError) {
    for (const item of error.issues) {
      console.error(`[ERROR] row=${item.rowNumber} code=${item.code} ${item.message}`);
    }
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
