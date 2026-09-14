import { Prisma, type UsageCategory } from '@prisma/client';

export const USAGE_TARIFF_IMPORT_COLUMNS = [
  'category',
  'provider',
  'unit',
  'pricePerUnit',
  'currency',
  'effectiveFrom',
  'effectiveTo',
  'version',
  'source',
] as const;

export const USAGE_CATEGORIES = new Set<UsageCategory>([
  'TELEPHONY_SECONDS',
  'STT_SECONDS',
  'TTS_CHARACTERS',
  'LLM_INPUT_TOKENS',
  'LLM_OUTPUT_TOKENS',
  'SMS_SEGMENTS',
  'WHATSAPP_MESSAGES',
  'EMAIL_MESSAGES',
  'RECORDING_BYTE_DAYS',
]);

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface UsageTariffImportRow {
  readonly rowNumber: number;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly pricePerUnit: string;
  readonly currency: 'EUR';
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly version: number;
  readonly source: string;
}

export interface UsageTariffImportIssue {
  readonly rowNumber: number;
  readonly code:
    | 'MALFORMED_INPUT'
    | 'MISSING_COLUMN'
    | 'UNKNOWN_COLUMN'
    | 'INVALID_CATEGORY'
    | 'INVALID_PROVIDER'
    | 'INVALID_UNIT'
    | 'INVALID_PRICE'
    | 'INVALID_CURRENCY'
    | 'INVALID_DATE'
    | 'INVALID_WINDOW'
    | 'INVALID_VERSION'
    | 'INVALID_SOURCE'
    | 'DUPLICATE_ROW'
    | 'EXISTING_CONFLICT'
    | 'EFFECTIVE_WINDOW_OVERLAP';
  readonly message: string;
}

export interface ExistingUsageTariff {
  readonly id: string;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly pricePerUnit: Prisma.Decimal | string | number;
  readonly currency: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo: Date | null;
  readonly version: number;
  readonly source: string;
}

export interface UsageTariffImportPlan {
  readonly inserts: UsageTariffImportRow[];
  readonly skips: Array<{ readonly rowNumber: number; readonly tariffId: string }>;
  readonly issues: UsageTariffImportIssue[];
}

export class UsageTariffImportError extends Error {
  constructor(readonly issues: UsageTariffImportIssue[]) {
    super(`Usage tariff import is invalid (${issues.length} issue(s))`);
    this.name = 'UsageTariffImportError';
  }
}

function issue(
  rowNumber: number,
  code: UsageTariffImportIssue['code'],
  message: string,
): UsageTariffImportIssue {
  return { rowNumber, code, message };
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function parseDate(value: unknown, rowNumber: number, field: string): Date {
  const raw = normalizeText(value);
  const dateOnly = DATE_ONLY_PATTERN.test(raw);
  const iso = dateOnly ? `${raw}T00:00:00.000Z` : ISO_DATE_PATTERN.test(raw) ? raw : null;
  const date = iso ? new Date(iso) : new Date(Number.NaN);
  const normalizedDate = Number.isNaN(date.getTime()) ? '' : date.toISOString();
  const normalizedInput = dateOnly
    ? `${raw}T00:00:00.000Z`
    : raw.includes('.')
      ? raw.replace(/\.(\d{1,3})Z$/, (_match, fraction: string) => `.${fraction.padEnd(3, '0')}Z`)
      : raw.replace(/Z$/, '.000Z');
  const preservesCalendarDate = normalizedDate === normalizedInput;
  if (Number.isNaN(date.getTime()) || !preservesCalendarDate) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_DATE', `${field} must be an ISO date or YYYY-MM-DD`),
    ]);
  }
  return date;
}

function parsePrice(value: unknown, rowNumber: number): string {
  const raw = normalizeText(value);
  if (!DECIMAL_PATTERN.test(raw)) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_PRICE', 'pricePerUnit must be a non-negative decimal string'),
    ]);
  }
  const [whole, fraction = ''] = raw.split('.');
  if (whole.length + fraction.length > 18 || fraction.length > 9) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_PRICE', 'pricePerUnit exceeds DECIMAL(18,9)'),
    ]);
  }
  const price = new Prisma.Decimal(raw);
  if (!price.isFinite() || price.isNegative()) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_PRICE', 'pricePerUnit must be finite and non-negative'),
    ]);
  }
  return price.toFixed(9);
}

function parseVersion(value: unknown, rowNumber: number): number {
  const raw = normalizeText(value);
  const version = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(version) ||
    version <= 0 ||
    version > 2_147_483_647
  ) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_VERSION', 'version must be a positive 32-bit integer'),
    ]);
  }
  return version;
}

function parseRow(raw: Record<string, unknown>, rowNumber: number): UsageTariffImportRow {
  const category = normalizeText(raw.category).toUpperCase() as UsageCategory;
  if (!USAGE_CATEGORIES.has(category)) {
    throw new UsageTariffImportError([
      issue(
        rowNumber,
        'INVALID_CATEGORY',
        `Unknown usage category: ${normalizeText(raw.category)}`,
      ),
    ]);
  }

  const provider = normalizeText(raw.provider).toLowerCase();
  if (!provider || provider.length > 64) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_PROVIDER', 'provider must contain between 1 and 64 characters'),
    ]);
  }

  const unit = normalizeText(raw.unit).toLowerCase();
  if (!unit || unit.length > 32) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_UNIT', 'unit must contain between 1 and 32 characters'),
    ]);
  }

  const currency = normalizeText(raw.currency).toUpperCase();
  if (currency !== 'EUR') {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_CURRENCY', 'Only EUR tariffs are accepted by the usage ledger'),
    ]);
  }

  const effectiveFrom = parseDate(raw.effectiveFrom, rowNumber, 'effectiveFrom');
  const effectiveToRaw = normalizeText(raw.effectiveTo);
  const effectiveTo = effectiveToRaw ? parseDate(effectiveToRaw, rowNumber, 'effectiveTo') : null;
  if (effectiveTo && effectiveTo <= effectiveFrom) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_WINDOW', 'effectiveTo must be later than effectiveFrom'),
    ]);
  }

  const source = normalizeText(raw.source);
  if (!source || source.length > 191) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'INVALID_SOURCE', 'source must contain between 1 and 191 characters'),
    ]);
  }

  return {
    rowNumber,
    category,
    provider,
    unit,
    pricePerUnit: parsePrice(raw.pricePerUnit, rowNumber),
    currency: 'EUR',
    effectiveFrom,
    effectiveTo,
    version: parseVersion(raw.version, rowNumber),
    source,
  };
}

function ensureColumns(columns: string[], rowNumber: number): void {
  const expected = new Set<string>(USAGE_TARIFF_IMPORT_COLUMNS);
  const seen = new Set<string>();
  for (const column of columns) {
    const normalized = column.trim();
    if (!expected.has(normalized)) {
      throw new UsageTariffImportError([
        issue(
          rowNumber,
          'UNKNOWN_COLUMN',
          `Unknown tariff import column: ${normalized || '<empty>'}`,
        ),
      ]);
    }
    if (seen.has(normalized)) {
      throw new UsageTariffImportError([
        issue(rowNumber, 'MALFORMED_INPUT', `Column appears more than once: ${normalized}`),
      ]);
    }
    seen.add(normalized);
  }
  const missing = USAGE_TARIFF_IMPORT_COLUMNS.filter((column) => !seen.has(column));
  if (missing.length > 0) {
    throw new UsageTariffImportError([
      issue(rowNumber, 'MISSING_COLUMN', `Missing tariff import columns: ${missing.join(', ')}`),
    ]);
  }
}

/** Parse a small RFC-4180 CSV without adding a runtime dependency to the API. */
export function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (quoted) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
      continue;
    }
    if (character === ',') {
      record.push(field);
      field = '';
      continue;
    }
    if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index++;
      record.push(field);
      field = '';
      if (record.some((value) => value.trim() !== '')) records.push(record);
      record = [];
      continue;
    }
    field += character;
  }

  if (quoted) {
    throw new UsageTariffImportError([
      issue(1, 'MALFORMED_INPUT', 'CSV contains an unclosed quote'),
    ]);
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    if (record.some((value) => value.trim() !== '')) records.push(record);
  }
  return records;
}

function parseCsv(input: string): UsageTariffImportRow[] {
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ''));
  if (records.length === 0) {
    throw new UsageTariffImportError([issue(1, 'MALFORMED_INPUT', 'CSV is empty')]);
  }
  const headers = records[0]!.map((header) => header.trim());
  ensureColumns(headers, 1);
  const indexByColumn = new Map(headers.map((header, index) => [header, index]));
  const rows: UsageTariffImportRow[] = [];
  for (let index = 1; index < records.length; index++) {
    const values = records[index]!;
    if (values.length !== headers.length) {
      throw new UsageTariffImportError([
        issue(
          index + 1,
          'MALFORMED_INPUT',
          'CSV row has a different number of columns than the header',
        ),
      ]);
    }
    const raw = Object.fromEntries(
      USAGE_TARIFF_IMPORT_COLUMNS.map((column) => [column, values[indexByColumn.get(column)!]]),
    );
    rows.push(parseRow(raw, index + 1));
  }
  if (rows.length === 0) {
    throw new UsageTariffImportError([issue(1, 'MALFORMED_INPUT', 'CSV contains no tariff rows')]);
  }
  return rows;
}

function parseJson(input: string): UsageTariffImportRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.replace(/^\uFEFF/, ''));
  } catch {
    throw new UsageTariffImportError([issue(1, 'MALFORMED_INPUT', 'JSON cannot be parsed')]);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new UsageTariffImportError([
      issue(1, 'MALFORMED_INPUT', 'JSON must be a non-empty array'),
    ]);
  }
  return parsed.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new UsageTariffImportError([
        issue(index + 1, 'MALFORMED_INPUT', 'Each JSON row must be an object'),
      ]);
    }
    const keys = Object.keys(value);
    ensureColumns(keys, index + 1);
    return parseRow(value as Record<string, unknown>, index + 1);
  });
}

export function parseUsageTariffImport(
  input: string,
  format: 'csv' | 'json' = 'csv',
): UsageTariffImportRow[] {
  return format === 'json' ? parseJson(input) : parseCsv(input);
}

function dimensionKey(row: Pick<UsageTariffImportRow, 'category' | 'provider' | 'unit'>): string {
  return `${row.category}|${row.provider}|${row.unit}`;
}

function versionKey(
  row: Pick<UsageTariffImportRow, 'category' | 'provider' | 'unit' | 'version'>,
): string {
  return `${dimensionKey(row)}|${row.version}`;
}

function decimalString(value: Prisma.Decimal | string | number): string {
  return new Prisma.Decimal(value).toFixed(9);
}

function sameTariff(row: UsageTariffImportRow, existing: ExistingUsageTariff): boolean {
  return (
    row.category === existing.category &&
    row.provider === existing.provider.trim().toLowerCase() &&
    row.unit === existing.unit.trim().toLowerCase() &&
    row.pricePerUnit === decimalString(existing.pricePerUnit) &&
    existing.currency.trim().toUpperCase() === 'EUR' &&
    row.effectiveFrom.getTime() === existing.effectiveFrom.getTime() &&
    (row.effectiveTo?.getTime() ?? null) === (existing.effectiveTo?.getTime() ?? null) &&
    row.version === existing.version &&
    row.source === existing.source.trim()
  );
}

function windowsOverlap(
  leftStart: Date,
  leftEnd: Date | null,
  rightStart: Date,
  rightEnd: Date | null,
): boolean {
  const leftEndMs = leftEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightEndMs = rightEnd?.getTime() ?? Number.POSITIVE_INFINITY;
  return leftStart.getTime() < rightEndMs && rightStart.getTime() < leftEndMs;
}

/**
 * Validate an import against the current catalog. Identical rows are skipped;
 * conflicting versions and overlapping effective windows fail closed so the
 * resolver never has to guess which vendor rate is authoritative.
 */
export function planUsageTariffImport(
  rows: UsageTariffImportRow[],
  existing: ExistingUsageTariff[],
): UsageTariffImportPlan {
  const issues: UsageTariffImportIssue[] = [];
  const inserts: UsageTariffImportRow[] = [];
  const skips: Array<{ readonly rowNumber: number; readonly tariffId: string }> = [];
  const seen = new Map<string, UsageTariffImportRow>();
  const existingByVersion = new Map(existing.map((row) => [versionKey(row), row]));

  for (const row of rows) {
    const key = versionKey(row);
    const duplicate = seen.get(key);
    if (duplicate) {
      issues.push(
        issue(
          row.rowNumber,
          'DUPLICATE_ROW',
          `Same dimension/version already appears on row ${duplicate.rowNumber}`,
        ),
      );
      continue;
    }
    seen.set(key, row);

    const current = existingByVersion.get(key);
    if (current) {
      if (sameTariff(row, current)) skips.push({ rowNumber: row.rowNumber, tariffId: current.id });
      else {
        issues.push(
          issue(
            row.rowNumber,
            'EXISTING_CONFLICT',
            `Dimension/version already exists with different tariff data (${current.id})`,
          ),
        );
      }
      continue;
    }
    inserts.push(row);
  }

  const candidateRows = inserts;
  for (const candidate of candidateRows) {
    for (const current of existing) {
      if (
        dimensionKey(candidate) === dimensionKey(current) &&
        versionKey(candidate) !== versionKey(current) &&
        windowsOverlap(
          candidate.effectiveFrom,
          candidate.effectiveTo,
          current.effectiveFrom,
          current.effectiveTo,
        )
      ) {
        issues.push(
          issue(
            candidate.rowNumber,
            'EFFECTIVE_WINDOW_OVERLAP',
            `Effective window overlaps existing tariff ${current.id}`,
          ),
        );
      }
    }
  }
  for (let left = 0; left < candidateRows.length; left++) {
    for (let right = left + 1; right < candidateRows.length; right++) {
      const first = candidateRows[left]!;
      const second = candidateRows[right]!;
      if (
        dimensionKey(first) === dimensionKey(second) &&
        windowsOverlap(
          first.effectiveFrom,
          first.effectiveTo,
          second.effectiveFrom,
          second.effectiveTo,
        )
      ) {
        issues.push(
          issue(
            second.rowNumber,
            'EFFECTIVE_WINDOW_OVERLAP',
            `Effective window overlaps import row ${first.rowNumber}`,
          ),
        );
      }
    }
  }

  return { inserts: issues.length === 0 ? inserts : [], skips, issues };
}

export function toUsageTariffCreateData(row: UsageTariffImportRow) {
  return {
    category: row.category,
    provider: row.provider,
    unit: row.unit,
    pricePerUnit: new Prisma.Decimal(row.pricePerUnit),
    currency: row.currency,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    version: row.version,
    source: row.source,
  };
}
