import { createHash } from 'node:crypto';
import { Prisma, type UsageCategory } from '@prisma/client';
import { parseCsvRecords, USAGE_CATEGORIES } from './usage-tariff-import.service';

export const USAGE_INVOICE_IMPORT_COLUMNS = [
  'category',
  'provider',
  'unit',
  'periodStart',
  'periodEnd',
  'billedQuantity',
  'billedCostEur',
  'currency',
  'source',
] as const;

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type UsageReconciliationStatus =
  | 'MATCH'
  | 'MISMATCH'
  | 'INVOICE_ONLY'
  | 'USAGE_ONLY'
  | 'UNPRICED_USAGE';

export interface UsageInvoiceImportRow {
  readonly rowNumber: number;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly periodStart: Date;
  /** Exclusive UTC end of the billed period. */
  readonly periodEnd: Date;
  readonly billedQuantity: string;
  readonly billedCostEur: string;
  readonly currency: 'EUR';
  readonly source: string;
}

export interface UsageReconciliationIssue {
  readonly rowNumber: number;
  readonly code:
    | 'MALFORMED_INPUT'
    | 'MISSING_COLUMN'
    | 'UNKNOWN_COLUMN'
    | 'INVALID_CATEGORY'
    | 'INVALID_PROVIDER'
    | 'INVALID_UNIT'
    | 'INVALID_DATE'
    | 'INVALID_WINDOW'
    | 'INVALID_QUANTITY'
    | 'INVALID_COST'
    | 'INVALID_CURRENCY'
    | 'INVALID_SOURCE'
    | 'INVOICE_WINDOW_OVERLAP';
  readonly message: string;
}

export class UsageReconciliationImportError extends Error {
  constructor(readonly issues: UsageReconciliationIssue[]) {
    super(`Usage invoice import is invalid (${issues.length} issue(s))`);
    this.name = 'UsageReconciliationImportError';
  }
}

export interface UsageReconciliationEvent {
  readonly restaurantId: string;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly quantity: Prisma.Decimal | string | number;
  readonly estimatedCostEur: Prisma.Decimal | string | number;
  readonly occurredAt: Date;
  readonly metadata?: unknown;
}

export interface UsageReconciliationReportRow {
  readonly status: UsageReconciliationStatus;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly source: string | null;
  readonly billedQuantity: string | null;
  readonly observedQuantity: string;
  readonly quantityDelta: string | null;
  readonly billedCostEur: string | null;
  readonly observedCostEur: string;
  readonly costDeltaEur: string | null;
  readonly eventCount: number;
  readonly pricedEvents: number;
  readonly unpricedEvents: number;
  readonly restaurantIds: string[];
}

export interface UsageReconciliationReport {
  readonly rows: UsageReconciliationReportRow[];
  readonly counts: Record<UsageReconciliationStatus, number>;
}

export interface UsageReconciliationReportHashInput {
  readonly report: UsageReconciliationReport;
  readonly scope: { readonly start: string; readonly end: string };
  readonly restaurantId: string | null;
  readonly quantityTolerance: string;
  readonly costToleranceEur: string;
}

function issue(
  rowNumber: number,
  code: UsageReconciliationIssue['code'],
  message: string,
): UsageReconciliationIssue {
  return { rowNumber, code, message };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function date(value: unknown, rowNumber: number, field: string): Date {
  const raw = text(value);
  const dateOnly = DATE_ONLY_PATTERN.test(raw);
  const iso = dateOnly ? `${raw}T00:00:00.000Z` : ISO_DATE_PATTERN.test(raw) ? raw : null;
  const parsed = iso ? new Date(iso) : new Date(Number.NaN);
  const normalized = Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  const normalizedInput = dateOnly
    ? `${raw}T00:00:00.000Z`
    : raw.includes('.')
      ? raw.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, '0')}Z`)
      : raw.replace(/Z$/, '.000Z');
  if (Number.isNaN(parsed.getTime()) || normalized !== normalizedInput) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_DATE', `${field} must be an ISO date or YYYY-MM-DD`),
    ]);
  }
  return parsed;
}

function decimal(
  value: unknown,
  rowNumber: number,
  field: 'billedQuantity' | 'billedCostEur',
): string {
  const raw = text(value);
  const code = field === 'billedQuantity' ? 'INVALID_QUANTITY' : 'INVALID_COST';
  if (!DECIMAL_PATTERN.test(raw)) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, code, `${field} must be a non-negative decimal string`),
    ]);
  }
  const [whole, fraction = ''] = raw.split('.');
  if (whole.length + fraction.length > 18 || fraction.length > 6) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, code, `${field} exceeds DECIMAL(18,6)`),
    ]);
  }
  const parsed = new Prisma.Decimal(raw);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, code, `${field} must be finite and non-negative`),
    ]);
  }
  return parsed.toFixed(6);
}

function ensureColumns(columns: string[]): void {
  const expected = new Set<string>(USAGE_INVOICE_IMPORT_COLUMNS);
  const seen = new Set<string>();
  for (const column of columns) {
    const normalized = column.trim();
    if (!expected.has(normalized)) {
      throw new UsageReconciliationImportError([
        issue(1, 'UNKNOWN_COLUMN', `Unknown invoice column: ${normalized || '<empty>'}`),
      ]);
    }
    if (seen.has(normalized)) {
      throw new UsageReconciliationImportError([
        issue(1, 'MALFORMED_INPUT', `Column appears more than once: ${normalized}`),
      ]);
    }
    seen.add(normalized);
  }
  const missing = USAGE_INVOICE_IMPORT_COLUMNS.filter((column) => !seen.has(column));
  if (missing.length > 0) {
    throw new UsageReconciliationImportError([
      issue(1, 'MISSING_COLUMN', `Missing invoice columns: ${missing.join(', ')}`),
    ]);
  }
}

function dimensionKey(row: Pick<UsageInvoiceImportRow, 'category' | 'provider' | 'unit'>): string {
  return `${row.category}|${row.provider}|${row.unit}`;
}

function windowsOverlap(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date): boolean {
  return leftStart < rightEnd && rightStart < leftEnd;
}

function validateInvoiceWindows(rows: UsageInvoiceImportRow[]): void {
  for (let left = 0; left < rows.length; left++) {
    for (let right = left + 1; right < rows.length; right++) {
      const first = rows[left]!;
      const second = rows[right]!;
      if (
        dimensionKey(first) === dimensionKey(second) &&
        (first.periodStart.getTime() !== second.periodStart.getTime() ||
          first.periodEnd.getTime() !== second.periodEnd.getTime()) &&
        windowsOverlap(first.periodStart, first.periodEnd, second.periodStart, second.periodEnd)
      ) {
        throw new UsageReconciliationImportError([
          issue(
            second.rowNumber,
            'INVOICE_WINDOW_OVERLAP',
            `Invoice period overlaps row ${first.rowNumber} for the same usage dimension`,
          ),
        ]);
      }
    }
  }
}

function parseInvoiceRow(raw: Record<string, unknown>, rowNumber: number): UsageInvoiceImportRow {
  const category = text(raw.category).toUpperCase() as UsageCategory;
  if (!USAGE_CATEGORIES.has(category)) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_CATEGORY', `Unknown usage category: ${text(raw.category)}`),
    ]);
  }
  const provider = text(raw.provider).toLowerCase();
  if (!provider || provider.length > 64) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_PROVIDER', 'provider must contain between 1 and 64 characters'),
    ]);
  }
  const unit = text(raw.unit).toLowerCase();
  if (!unit || unit.length > 32) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_UNIT', 'unit must contain between 1 and 32 characters'),
    ]);
  }
  const periodStart = date(raw.periodStart, rowNumber, 'periodStart');
  const periodEnd = date(raw.periodEnd, rowNumber, 'periodEnd');
  if (periodEnd <= periodStart) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_WINDOW', 'periodEnd must be later than periodStart'),
    ]);
  }
  if (text(raw.currency).toUpperCase() !== 'EUR') {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_CURRENCY', 'Only EUR invoice amounts are supported'),
    ]);
  }
  const source = text(raw.source);
  if (!source || source.length > 191) {
    throw new UsageReconciliationImportError([
      issue(rowNumber, 'INVALID_SOURCE', 'source must contain between 1 and 191 characters'),
    ]);
  }
  return {
    rowNumber,
    category,
    provider,
    unit,
    periodStart,
    periodEnd,
    billedQuantity: decimal(raw.billedQuantity, rowNumber, 'billedQuantity'),
    billedCostEur: decimal(raw.billedCostEur, rowNumber, 'billedCostEur'),
    currency: 'EUR',
    source,
  };
}

function parseCsv(input: string): UsageInvoiceImportRow[] {
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ''));
  if (records.length === 0) {
    throw new UsageReconciliationImportError([issue(1, 'MALFORMED_INPUT', 'Invoice CSV is empty')]);
  }
  const headers = records[0]!.map((header) => header.trim());
  ensureColumns(headers);
  const indexByColumn = new Map(headers.map((header, index) => [header, index]));
  const rows: UsageInvoiceImportRow[] = [];
  for (let index = 1; index < records.length; index++) {
    const values = records[index]!;
    if (values.length !== headers.length) {
      throw new UsageReconciliationImportError([
        issue(
          index + 1,
          'MALFORMED_INPUT',
          'Invoice row has a different number of columns than the header',
        ),
      ]);
    }
    const raw = Object.fromEntries(
      USAGE_INVOICE_IMPORT_COLUMNS.map((column) => [column, values[indexByColumn.get(column)!]]),
    );
    rows.push(parseInvoiceRow(raw, index + 1));
  }
  if (rows.length === 0) {
    throw new UsageReconciliationImportError([
      issue(1, 'MALFORMED_INPUT', 'Invoice CSV contains no data rows'),
    ]);
  }
  validateInvoiceWindows(rows);
  return rows;
}

function parseJson(input: string): UsageInvoiceImportRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.replace(/^\uFEFF/, ''));
  } catch {
    throw new UsageReconciliationImportError([
      issue(1, 'MALFORMED_INPUT', 'Invoice JSON cannot be parsed'),
    ]);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new UsageReconciliationImportError([
      issue(1, 'MALFORMED_INPUT', 'Invoice JSON must be a non-empty array'),
    ]);
  }
  const rows = parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UsageReconciliationImportError([
        issue(index + 1, 'MALFORMED_INPUT', 'Each invoice JSON row must be an object'),
      ]);
    }
    const keys = Object.keys(value);
    ensureColumns(keys);
    return parseInvoiceRow(value as Record<string, unknown>, index + 1);
  });
  validateInvoiceWindows(rows);
  return rows;
}

export function parseUsageInvoiceImport(
  input: string,
  format: 'csv' | 'json' = 'csv',
): UsageInvoiceImportRow[] {
  return format === 'json' ? parseJson(input) : parseCsv(input);
}

/**
 * Hash the deterministic contents of a reconciliation report. Runtime-only
 * fields such as generation time and local file paths are deliberately absent,
 * so a rerun over the same invoice/ledger snapshot can be replayed safely.
 */
export function hashUsageReconciliationReport(input: UsageReconciliationReportHashInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        scope: input.scope,
        restaurantId: input.restaurantId,
        tolerances: {
          quantity: input.quantityTolerance,
          costEur: input.costToleranceEur,
        },
        counts: input.report.counts,
        rows: input.report.rows,
      }),
    )
    .digest('hex');
}

function decimalValue(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function pricedMetadata(metadata: unknown, estimatedCost: Prisma.Decimal): boolean {
  if (metadata && typeof metadata === 'object') {
    const status = (metadata as Record<string, unknown>).costStatus;
    if (status === 'PRICED') return true;
    if (status === 'UNPRICED') return false;
  }
  return !estimatedCost.isZero();
}

function invoiceKey(row: UsageInvoiceImportRow): string {
  return `${dimensionKey(row)}|${row.periodStart.toISOString()}|${row.periodEnd.toISOString()}|${row.source}`;
}

function usageKey(row: Pick<UsageReconciliationEvent, 'category' | 'provider' | 'unit'>): string {
  return `${row.category}|${row.provider.trim().toLowerCase()}|${row.unit.trim().toLowerCase()}`;
}

function within(event: UsageReconciliationEvent, row: UsageInvoiceImportRow): boolean {
  return (
    usageKey(event) === dimensionKey(row) &&
    event.occurredAt >= row.periodStart &&
    event.occurredAt < row.periodEnd
  );
}

function withinTolerance(delta: Prisma.Decimal, tolerance: Prisma.Decimal): boolean {
  return delta.abs().lte(tolerance);
}

function reportRowForInvoice(
  invoice: UsageInvoiceImportRow & {
    readonly billedQuantityDecimal: Prisma.Decimal;
    readonly billedCostDecimal: Prisma.Decimal;
  },
  events: UsageReconciliationEvent[],
  quantityTolerance: Prisma.Decimal,
  costTolerance: Prisma.Decimal,
): UsageReconciliationReportRow {
  const observedQuantity = events.reduce(
    (sum, event) => sum.add(decimalValue(event.quantity)),
    new Prisma.Decimal(0),
  );
  const observedCost = events.reduce(
    (sum, event) => sum.add(decimalValue(event.estimatedCostEur)),
    new Prisma.Decimal(0),
  );
  const pricedEvents = events.filter((event) =>
    pricedMetadata(event.metadata, decimalValue(event.estimatedCostEur)),
  ).length;
  const unpricedEvents = events.length - pricedEvents;
  const quantityDelta = observedQuantity.sub(invoice.billedQuantityDecimal);
  const costDelta = observedCost.sub(invoice.billedCostDecimal);
  const status: UsageReconciliationStatus =
    events.length === 0
      ? 'INVOICE_ONLY'
      : unpricedEvents > 0
        ? 'UNPRICED_USAGE'
        : withinTolerance(quantityDelta, quantityTolerance) &&
            withinTolerance(costDelta, costTolerance)
          ? 'MATCH'
          : 'MISMATCH';
  return {
    status,
    category: invoice.category,
    provider: invoice.provider,
    unit: invoice.unit,
    periodStart: invoice.periodStart.toISOString(),
    periodEnd: invoice.periodEnd.toISOString(),
    source: invoice.source,
    billedQuantity: invoice.billedQuantityDecimal.toFixed(6),
    observedQuantity: observedQuantity.toFixed(6),
    quantityDelta: quantityDelta.toFixed(6),
    billedCostEur: invoice.billedCostDecimal.toFixed(6),
    observedCostEur: observedCost.toFixed(6),
    costDeltaEur: costDelta.toFixed(6),
    eventCount: events.length,
    pricedEvents,
    unpricedEvents,
    restaurantIds: [...new Set(events.map((event) => event.restaurantId))].sort(),
  };
}

/**
 * Compare a provider invoice snapshot with immutable usage events. The
 * function only reports differences; it never mutates the ledger or rollups.
 */
export function reconcileUsageInvoice(input: {
  readonly invoiceRows: UsageInvoiceImportRow[];
  readonly usageEvents: UsageReconciliationEvent[];
  readonly quantityTolerance?: string | number;
  readonly costToleranceEur?: string | number;
}): UsageReconciliationReport {
  if (input.invoiceRows.length === 0) {
    throw new Error('invoiceRows must contain at least one row');
  }
  const quantityTolerance = decimalValue(input.quantityTolerance ?? 0);
  const costTolerance = decimalValue(input.costToleranceEur ?? 0);
  if (quantityTolerance.isNegative() || costTolerance.isNegative()) {
    throw new Error('reconciliation tolerances must be non-negative');
  }

  const groupedInvoices = new Map<
    string,
    UsageInvoiceImportRow & {
      billedQuantityDecimal: Prisma.Decimal;
      billedCostDecimal: Prisma.Decimal;
    }
  >();
  for (const row of input.invoiceRows) {
    const key = invoiceKey(row);
    const existing = groupedInvoices.get(key);
    if (existing) {
      existing.billedQuantityDecimal = existing.billedQuantityDecimal.add(
        decimalValue(row.billedQuantity),
      );
      existing.billedCostDecimal = existing.billedCostDecimal.add(decimalValue(row.billedCostEur));
    } else {
      groupedInvoices.set(key, {
        ...row,
        billedQuantityDecimal: decimalValue(row.billedQuantity),
        billedCostDecimal: decimalValue(row.billedCostEur),
      });
    }
  }

  const rows: UsageReconciliationReportRow[] = [];
  const covered = new Set<number>();
  for (const invoice of groupedInvoices.values()) {
    const matching: UsageReconciliationEvent[] = [];
    input.usageEvents.forEach((event, index) => {
      if (within(event, invoice)) {
        matching.push(event);
        covered.add(index);
      }
    });
    rows.push(reportRowForInvoice(invoice, matching, quantityTolerance, costTolerance));
  }

  const usageOnly = new Map<string, UsageReconciliationEvent[]>();
  input.usageEvents.forEach((event, index) => {
    if (covered.has(index)) return;
    const key = usageKey(event);
    const bucket = usageOnly.get(key) ?? [];
    bucket.push(event);
    usageOnly.set(key, bucket);
  });
  const invoiceDimensions = new Set([...groupedInvoices.values()].map((row) => dimensionKey(row)));
  const scopeStart = input.invoiceRows.reduce(
    (min, row) => (row.periodStart < min ? row.periodStart : min),
    input.invoiceRows[0]!.periodStart,
  );
  const scopeEnd = input.invoiceRows.reduce(
    (max, row) => (row.periodEnd > max ? row.periodEnd : max),
    input.invoiceRows[0]!.periodEnd,
  );
  for (const [key, events] of usageOnly) {
    const [category, provider, unit] = key.split('|') as [UsageCategory, string, string];
    const observedQuantity = events.reduce(
      (sum, event) => sum.add(decimalValue(event.quantity)),
      new Prisma.Decimal(0),
    );
    const observedCost = events.reduce(
      (sum, event) => sum.add(decimalValue(event.estimatedCostEur)),
      new Prisma.Decimal(0),
    );
    const pricedEvents = events.filter((event) =>
      pricedMetadata(event.metadata, decimalValue(event.estimatedCostEur)),
    ).length;
    const unpricedEvents = events.length - pricedEvents;
    rows.push({
      status: invoiceDimensions.has(key) && unpricedEvents > 0 ? 'UNPRICED_USAGE' : 'USAGE_ONLY',
      category,
      provider,
      unit,
      periodStart: scopeStart.toISOString(),
      periodEnd: scopeEnd.toISOString(),
      source: null,
      billedQuantity: null,
      observedQuantity: observedQuantity.toFixed(6),
      quantityDelta: null,
      billedCostEur: null,
      observedCostEur: observedCost.toFixed(6),
      costDeltaEur: null,
      eventCount: events.length,
      pricedEvents,
      unpricedEvents,
      restaurantIds: [...new Set(events.map((event) => event.restaurantId))].sort(),
    });
  }

  rows.sort((left, right) => {
    const status = left.status.localeCompare(right.status);
    if (status !== 0) return status;
    return `${left.category}|${left.provider}|${left.unit}|${left.periodStart}`.localeCompare(
      `${right.category}|${right.provider}|${right.unit}|${right.periodStart}`,
    );
  });
  const counts: Record<UsageReconciliationStatus, number> = {
    MATCH: 0,
    MISMATCH: 0,
    INVOICE_ONLY: 0,
    USAGE_ONLY: 0,
    UNPRICED_USAGE: 0,
  };
  for (const row of rows) counts[row.status]++;
  return { rows, counts };
}
