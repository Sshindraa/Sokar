/**
 * Read-only Telnyx billing export for the usage reconciliation gate.
 *
 * Examples:
 *   TELNYX_API_KEY=... pnpm --filter @sokar/api usage:telnyx:fetch \
 *     --month 2026-09 --product messaging \
 *     --invoice-id 48eff763-ea80-4345-b688-78249eb165a8 \
 *     --output ./private/telnyx-usage-2026-09.json
 *
 * The command never writes to Sokar or Telnyx. It writes a normalized invoice
 * file plus a sidecar manifest containing hashes and non-sensitive invoice
 * metadata. The signed download_url returned by Telnyx is never persisted;
 * --invoice-file may copy the bounded file to a local path when requested.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import {
  fetchTelnyxInvoice,
  fetchTelnyxUsageReport,
  hashTelnyxUsageSnapshot,
  hashTelnyxUsageSnapshots,
  downloadTelnyxInvoice,
  listTelnyxInvoices,
  serializeTelnyxInvoiceRows,
  telnyxUsageReportToInvoiceRows,
  TELNYX_USAGE_PRODUCT_MAPPINGS,
  type TelnyxInvoiceSummary,
} from '../src/modules/usage/telnyx-billing.service.js';
import type { UsageInvoiceImportRow } from '../src/modules/usage/usage-reconciliation.service.js';

interface Args {
  readonly month: string;
  readonly product?: string[];
  readonly invoiceId?: string;
  readonly invoiceFile?: string;
  readonly quantityField?: string;
  readonly allowEmpty: boolean;
  readonly currency: 'EUR';
  readonly dimensions: string[];
  readonly filters: Record<string, string | readonly string[]>;
  readonly pageSize?: number;
  readonly output: string;
  readonly manifest?: string;
  readonly listInvoices: boolean;
}

interface InvoiceFileManifest {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly contentType: string | null;
}

const log = (message: string): void => {
  process.stdout.write(`${message}\n`);
};

function usage(): void {
  log(`Usage:
  TELNYX_API_KEY=... pnpm --filter @sokar/api usage:telnyx:fetch --month YYYY-MM --product <product> --output <path> [options]
  TELNYX_API_KEY=... pnpm --filter @sokar/api usage:telnyx:fetch --month YYYY-MM --list-invoices --output <path>

Options:
  --month <YYYY-MM>             UTC month to export (required).
  --product <name[,name]>       messaging, sip-trunking or call-control (repeatable; required for usage).
  --invoice-id <id>             Fetch invoice metadata for this Telnyx invoice ID.
  --invoice-file <path>         Download the invoice PDF/file locally (requires --invoice-id).
  --quantity-field <metric>     Override quantity metric (only with one product; defaults parts/billed_sec).
  --allow-empty                 Represent a provider report with zero rows as zero usage.
  --currency EUR                 Sokar reconciliation accepts EUR only (default: EUR).
  --dimensions <csv>            Telnyx dimensions (default: currency).
  --filter <key=value>          Repeatable Telnyx filter, for example direction=outbound.
  --page-size <n>               Telnyx page size (default: 1000).
  --output <path>               Normalized CSV or JSON output (required).
  --manifest <path>             Sidecar manifest path (default: <output>.manifest.json).
  --list-invoices               List invoice metadata for the month instead of fetching usage.
  --help, -h                    Show this help.`);
}

function parsePositiveInteger(value: string, option: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`${option} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function parseMonth(value: string): string {
  if (!/^\d{4}-\d{2}$/.test(value)) throw new Error('--month must use YYYY-MM');
  const start = new Date(`${value}-01T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 7) !== value) {
    throw new Error('--month is not a valid calendar month');
  }
  return value;
}

function monthWindow(month: string): { readonly start: Date; readonly end: Date } {
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const [yearText, monthText] = month.split('-');
  const end = new Date(Date.UTC(Number(yearText), Number(monthText), 1));
  return { start, end };
}

function parseFilter(value: string): { readonly key: string; readonly value: string } {
  const separator = value.indexOf('=');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('--filter must use key=value');
  }
  return { key: value.slice(0, separator), value: value.slice(separator + 1) };
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let month: string | undefined;
  let product: string[] | undefined;
  let invoiceId: string | undefined;
  let invoiceFile: string | undefined;
  let quantityField: string | undefined;
  let allowEmpty = false;
  let currency: Args['currency'] = 'EUR';
  let dimensions = ['currency'];
  const filters: Record<string, string | readonly string[]> = {};
  let pageSize: number | undefined;
  let output: string | undefined;
  let manifest: string | undefined;
  let listInvoices = false;

  for (let index = 0; index < raw.length; index++) {
    const arg = raw[index];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    }
    if (arg === '--list-invoices') {
      listInvoices = true;
      continue;
    }
    if (arg === '--allow-empty') {
      allowEmpty = true;
      continue;
    }
    if (
      arg === '--month' ||
      arg === '--product' ||
      arg === '--invoice-id' ||
      arg === '--invoice-file' ||
      arg === '--quantity-field' ||
      arg === '--currency' ||
      arg === '--dimensions' ||
      arg === '--filter' ||
      arg === '--page-size' ||
      arg === '--output' ||
      arg === '--manifest'
    ) {
      const value = raw[++index];
      if (!value || value.startsWith('-')) throw new Error(`${arg} requires a value`);
      if (arg === '--month') month = parseMonth(value);
      else if (arg === '--product') {
        const products = value
          .split(',')
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean);
        if (products.length === 0) throw new Error('--product must contain a product name');
        product = [...(product ?? []), ...products];
      } else if (arg === '--invoice-id') invoiceId = value;
      else if (arg === '--invoice-file') invoiceFile = value;
      else if (arg === '--quantity-field') quantityField = value;
      else if (arg === '--currency') {
        if (value.toUpperCase() !== 'EUR') throw new Error('--currency must be EUR');
        currency = 'EUR';
      } else if (arg === '--dimensions') {
        dimensions = value
          .split(',')
          .map((dimension) => dimension.trim())
          .filter(Boolean);
      } else if (arg === '--filter') {
        const filter = parseFilter(value);
        const previous = filters[filter.key];
        filters[filter.key] = previous
          ? [...(Array.isArray(previous) ? previous : [previous]), filter.value]
          : filter.value;
      } else if (arg === '--page-size') pageSize = parsePositiveInteger(value, '--page-size');
      else if (arg === '--output') output = value;
      else manifest = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!month) throw new Error('--month is required');
  if (!output) throw new Error('--output is required');
  if (listInvoices && (product?.length || invoiceId || invoiceFile || quantityField)) {
    throw new Error('--list-invoices cannot be combined with usage options');
  }
  if (!listInvoices && (!product || product.length === 0))
    throw new Error('--product is required unless --list-invoices is set');
  if (!listInvoices && product && product.length > 1 && quantityField) {
    throw new Error('--quantity-field can only be used when one product is selected');
  }
  if (!listInvoices && invoiceFile && !invoiceId) {
    throw new Error('--invoice-file requires --invoice-id');
  }
  return {
    month,
    product,
    invoiceId,
    invoiceFile,
    quantityField,
    allowEmpty,
    currency,
    dimensions,
    filters,
    pageSize,
    output,
    manifest,
    listInvoices,
  };
}

function outputFormat(path: string): 'csv' | 'json' {
  return extname(path).toLowerCase() === '.csv' ? 'csv' : 'json';
}

function invoiceOverlapsMonth(invoice: TelnyxInvoiceSummary, start: Date, end: Date): boolean {
  const invoiceStart = new Date(`${invoice.periodStart}T00:00:00.000Z`);
  // Telnyx invoice period_end is inclusive; make it exclusive for comparison.
  const invoiceEndExclusive = new Date(`${invoice.periodEnd}T00:00:00.000Z`);
  invoiceEndExclusive.setUTCDate(invoiceEndExclusive.getUTCDate() + 1);
  return invoiceStart < end && invoiceEndExclusive > start;
}

async function writeOutput(path: string, content: string): Promise<void> {
  const outputPath = resolve(process.cwd(), path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, content, 'utf8');
  log(`[OUTPUT] ${outputPath}`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apiKey = process.env.TELNYX_API_KEY?.trim();
  if (!apiKey)
    throw new Error('TELNYX_API_KEY is not defined; load it from the secret manager first');
  const { start, end } = monthWindow(args.month);

  if (args.listInvoices) {
    const invoices = await listTelnyxInvoices({ apiKey, pageSize: args.pageSize });
    const matching = invoices.filter((invoice) => invoiceOverlapsMonth(invoice, start, end));
    await writeOutput(
      args.output,
      `${JSON.stringify(
        matching.map(({ invoiceId, fileId, periodStart, periodEnd, paid, url }) => ({
          invoiceId,
          fileId,
          periodStart,
          periodEnd,
          paid,
          url,
        })),
        null,
        2,
      )}\n`,
    );
    log(`[INVOICES] ${matching.length} invoice(s) overlap ${args.month}`);
    return;
  }

  const products = args.product!;
  const reports: Array<{
    readonly product: string;
    readonly quantityMetric: string;
    readonly report: Awaited<ReturnType<typeof fetchTelnyxUsageReport>>;
  }> = [];
  const rows: UsageInvoiceImportRow[] = [];
  const source = args.invoiceId
    ? `invoice:telnyx:${args.invoiceId}`
    : `invoice:telnyx:usage:${args.month}:${products.join('+')}`;
  for (const product of products) {
    const quantityMetric =
      args.quantityField ??
      (product === 'messaging'
        ? TELNYX_USAGE_PRODUCT_MAPPINGS.messaging.defaultQuantityMetric
        : TELNYX_USAGE_PRODUCT_MAPPINGS['sip-trunking'].defaultQuantityMetric);
    const report = await fetchTelnyxUsageReport({
      apiKey,
      product,
      startDate: start,
      endDate: end,
      metrics: ['cost', quantityMetric],
      dimensions: args.dimensions,
      filters: args.filters,
      pageSize: args.pageSize,
    });
    reports.push({ product, quantityMetric, report });
    rows.push(
      ...telnyxUsageReportToInvoiceRows({
        report,
        currency: args.currency,
        quantityMetric,
        source,
        allowEmpty: args.allowEmpty,
      }),
    );
  }
  const reportHash =
    reports.length === 1
      ? hashTelnyxUsageSnapshot({
          report: reports[0]!.report,
          quantityMetric: reports[0]!.quantityMetric,
          currency: args.currency,
          source,
          invoiceId: args.invoiceId ?? null,
        })
      : hashTelnyxUsageSnapshots({
          reports: reports.map(({ report, quantityMetric }) => ({ report, quantityMetric })),
          currency: args.currency,
          source,
          invoiceId: args.invoiceId ?? null,
        });
  const invoice = args.invoiceId
    ? await fetchTelnyxInvoice({ apiKey, invoiceId: args.invoiceId })
    : null;
  if (invoice && !invoiceOverlapsMonth(invoice, start, end)) {
    throw new Error(`Invoice ${invoice.invoiceId} does not overlap requested month ${args.month}`);
  }

  let invoiceFileManifest: InvoiceFileManifest | null = null;
  if (args.invoiceFile) {
    if (!invoice) throw new Error('--invoice-file requires --invoice-id');
    const downloaded = await downloadTelnyxInvoice({ invoice });
    const invoicePath = resolve(process.cwd(), args.invoiceFile);
    await mkdir(dirname(invoicePath), { recursive: true });
    await writeFile(invoicePath, downloaded.bytes);
    invoiceFileManifest = {
      path: invoicePath,
      bytes: downloaded.bytes.length,
      sha256: downloaded.sha256,
      contentType: downloaded.contentType,
    };
    log(
      `[INVOICE_FILE] ${invoicePath} (${downloaded.bytes.length} bytes, sha256=${downloaded.sha256})`,
    );
  }

  await writeOutput(args.output, serializeTelnyxInvoiceRows(rows, outputFormat(args.output)));
  const manifestPath = args.manifest ?? `${args.output}.manifest.json`;
  await writeOutput(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        provider: 'telnyx',
        products,
        currency: args.currency,
        periodStart: reports[0]!.report.startDate,
        periodEnd: reports[0]!.report.endDate,
        source,
        reportHash,
        snapshots: reports.map(({ product, quantityMetric, report }) => ({
          product,
          quantityMetric,
          periodStart: report.startDate,
          periodEnd: report.endDate,
          usageRows: report.data.length,
          reportHash: hashTelnyxUsageSnapshot({
            report,
            quantityMetric,
            currency: args.currency,
            source,
            invoiceId: args.invoiceId ?? null,
          }),
        })),
        invoice: invoice
          ? {
              invoiceId: invoice.invoiceId,
              fileId: invoice.fileId,
              periodStart: invoice.periodStart,
              periodEnd: invoice.periodEnd,
              paid: invoice.paid,
              url: invoice.url,
            }
          : null,
        invoiceFile: invoiceFileManifest,
        signedDownloadUrlStored: false,
      },
      null,
      2,
    )}\n`,
  );
  log(`[REPORT_HASH] ${reportHash}`);
  log(
    `[USAGE] ${reports.reduce((sum, item) => sum + item.report.data.length, 0)} Telnyx row(s) across ${products.length} product(s) aggregated into ${rows.length} invoice row(s)`,
  );
  log(
    `[INVOICE] ${invoice ? `${invoice.invoiceId} (${invoice.paid ? 'paid' : 'unpaid/unknown'})` : 'not requested'}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
