import { createHash } from 'node:crypto';

/** Stable columns for the vendor invoice sidecar. This file is deliberately
 * separate from the EUR usage ledger export: a provider subscription/MRC is
 * not a restaurant usage event and must keep its original currency. */
export const VENDOR_INVOICE_ACCOUNTING_COLUMNS = [
  'schema_version',
  'row_type',
  'provider',
  'invoice_id',
  'invoice_status',
  'period_start',
  'period_end',
  'line_type',
  'description',
  'quantity',
  'unit',
  'amount',
  'currency',
  'source_document',
  'source_document_sha256',
  'reconciliation_report_hash',
  'accounting_status',
] as const;

export type VendorInvoiceAccountingRow = {
  readonly schemaVersion: 1;
  readonly rowType: 'VENDOR_INVOICE';
  readonly provider: string;
  readonly invoiceId: string;
  readonly invoiceStatus: 'PAID' | 'OPEN' | 'UNKNOWN';
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly lineType: 'MRC';
  readonly description: string;
  readonly quantity: string;
  readonly unit: 'month';
  readonly amount: string;
  readonly currency: string;
  /** Relative path inside the package, never a signed provider URL. */
  readonly sourceDocument: string;
  readonly sourceDocumentSha256: string;
  readonly reconciliationReportHash: string | null;
  readonly accountingStatus: 'READY_FOR_IMPORT' | 'IMPORTED';
};

export type AccountingReconciliationCounts = {
  readonly MATCH: number;
  readonly MISMATCH: number;
  readonly INVOICE_ONLY: number;
  readonly USAGE_ONLY: number;
  readonly UNPRICED_USAGE: number;
};

export type AccountingPackageInput = {
  readonly month: string;
  readonly provider: string;
  readonly invoiceId: string;
  readonly invoiceStatus: VendorInvoiceAccountingRow['invoiceStatus'];
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly mrcAmount: string;
  readonly mrcCurrency: string;
  readonly invoiceDocument: string;
  readonly invoiceDocumentSha256: string;
  readonly usageExportSha256: string;
  readonly reconciliationFileSha256: string;
  readonly vendorInvoiceSha256?: string;
  readonly reconciliationReportHash: string;
  readonly reconciliationCounts: AccountingReconciliationCounts;
  readonly destination: 'file';
  readonly importReceipt?: string | null;
};

export type AccountingPackageManifest = {
  readonly schemaVersion: 1;
  readonly packageId: string;
  readonly generatedAt: string;
  readonly month: string;
  readonly provider: string;
  readonly destination: {
    readonly type: 'file';
    readonly status: 'READY_FOR_IMPORT' | 'IMPORTED';
    readonly importReceipt: string | null;
  };
  readonly usageExport: {
    readonly file: string;
    readonly currency: 'EUR';
    readonly sha256: string;
  };
  readonly vendorInvoice: {
    readonly file: string;
    readonly sha256: string;
    readonly invoiceId: string;
    readonly invoiceStatus: VendorInvoiceAccountingRow['invoiceStatus'];
    readonly mrc: {
      readonly amount: string;
      readonly currency: string;
      readonly unit: 'month';
    };
    readonly sourceDocument: string;
    readonly sourceDocumentSha256: string;
  };
  readonly reconciliation: {
    readonly file: string;
    readonly reportHash: string;
    readonly counts: AccountingReconciliationCounts;
    readonly sha256: string;
  };
};

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d{1,6})?$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const INVOICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PROVIDER_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function rowValue(
  row: VendorInvoiceAccountingRow,
  column: (typeof VENDOR_INVOICE_ACCOUNTING_COLUMNS)[number],
): unknown {
  switch (column) {
    case 'schema_version':
      return row.schemaVersion;
    case 'row_type':
      return row.rowType;
    case 'provider':
      return row.provider;
    case 'invoice_id':
      return row.invoiceId;
    case 'invoice_status':
      return row.invoiceStatus;
    case 'period_start':
      return row.periodStart;
    case 'period_end':
      return row.periodEnd;
    case 'line_type':
      return row.lineType;
    case 'description':
      return row.description;
    case 'quantity':
      return row.quantity;
    case 'unit':
      return row.unit;
    case 'amount':
      return row.amount;
    case 'currency':
      return row.currency;
    case 'source_document':
      return row.sourceDocument;
    case 'source_document_sha256':
      return row.sourceDocumentSha256;
    case 'reconciliation_report_hash':
      return row.reconciliationReportHash;
    case 'accounting_status':
      return row.accountingStatus;
  }
}

function assert(value: boolean, message: string): void {
  if (!value) throw new Error(message);
}

function assertDate(value: string, field: string): void {
  assert(DATE_PATTERN.test(value), `${field} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  assert(
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value,
    `${field} is not a valid calendar date`,
  );
}

function assertCounts(counts: AccountingReconciliationCounts): void {
  for (const key of [
    'MATCH',
    'MISMATCH',
    'INVOICE_ONLY',
    'USAGE_ONLY',
    'UNPRICED_USAGE',
  ] as const) {
    assert(
      Number.isSafeInteger(counts[key]) && counts[key] >= 0,
      `reconciliation count ${key} is invalid`,
    );
  }
  assert(
    counts.MISMATCH === 0 &&
      counts.INVOICE_ONLY === 0 &&
      counts.USAGE_ONLY === 0 &&
      counts.UNPRICED_USAGE === 0,
    'reconciliation must contain only MATCH rows before accounting export',
  );
}

function stablePackageMaterial(input: AccountingPackageInput): string {
  return JSON.stringify({
    schemaVersion: 1,
    month: input.month,
    provider: input.provider,
    invoiceId: input.invoiceId,
    invoiceStatus: input.invoiceStatus,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    mrcAmount: input.mrcAmount,
    mrcCurrency: input.mrcCurrency,
    invoiceDocument: input.invoiceDocument,
    invoiceDocumentSha256: input.invoiceDocumentSha256,
    usageExportSha256: input.usageExportSha256,
    reconciliationFileSha256: input.reconciliationFileSha256,
    reconciliationReportHash: input.reconciliationReportHash,
    reconciliationCounts: input.reconciliationCounts,
    destination: input.destination,
    importReceipt: input.importReceipt ?? null,
  });
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Validate the exact header emitted by the operator usage export. */
export function assertUsageAccountingCsv(content: string): void {
  const [header] = content.split(/\r?\n/, 1);
  const expected = [
    'schema_version',
    'month',
    'row_type',
    'restaurant_id',
    'restaurant_name',
    'plan',
    'category',
    'provider',
    'unit',
    'period_start',
    'period_end',
    'quantity',
    'cost_eur',
    'currency',
    'cost_status',
    'event_count',
    'source',
    'report_hash',
    'adjustment_id',
    'adjustment_status',
    'reason',
  ]
    .map(csvCell)
    .join(',');
  assert(header === expected, 'usage export does not use the versioned accounting CSV schema');
}

export function vendorInvoiceAccountingToCsv(input: {
  readonly row: VendorInvoiceAccountingRow;
}): string {
  const header = VENDOR_INVOICE_ACCOUNTING_COLUMNS.map(csvCell).join(',');
  const body = VENDOR_INVOICE_ACCOUNTING_COLUMNS.map((column) =>
    csvCell(rowValue(input.row, column)),
  ).join(',');
  return `${header}\n${body}\n`;
}

export function buildVendorInvoiceAccountingRow(
  input: AccountingPackageInput,
): VendorInvoiceAccountingRow {
  assert(MONTH_PATTERN.test(input.month), 'month must use YYYY-MM');
  assert(PROVIDER_PATTERN.test(input.provider), 'provider is invalid');
  assert(INVOICE_ID_PATTERN.test(input.invoiceId), 'invoiceId is invalid');
  assertDate(input.periodStart, 'periodStart');
  assertDate(input.periodEnd, 'periodEnd');
  assert(input.periodStart < input.periodEnd, 'periodEnd must be later than periodStart');
  assert(
    DECIMAL_PATTERN.test(input.mrcAmount),
    'mrcAmount must be a non-negative decimal with at most 6 places',
  );
  assert(
    CURRENCY_PATTERN.test(input.mrcCurrency),
    'mrcCurrency must be an uppercase ISO-4217 code',
  );
  assert(SHA256_PATTERN.test(input.invoiceDocumentSha256), 'invoiceDocumentSha256 is invalid');
  assert(
    SHA256_PATTERN.test(input.reconciliationReportHash),
    'reconciliationReportHash is invalid',
  );
  assert(SHA256_PATTERN.test(input.usageExportSha256), 'usageExportSha256 is invalid');
  assert(
    SHA256_PATTERN.test(input.reconciliationFileSha256),
    'reconciliationFileSha256 is invalid',
  );
  assertCounts(input.reconciliationCounts);
  assert(
    input.invoiceDocument.length > 0 &&
      !input.invoiceDocument.includes('://') &&
      !input.invoiceDocument.startsWith('/') &&
      !input.invoiceDocument.split('/').includes('..'),
    'invoiceDocument must be a relative package path',
  );

  return {
    schemaVersion: 1,
    rowType: 'VENDOR_INVOICE',
    provider: input.provider,
    invoiceId: input.invoiceId,
    invoiceStatus: input.invoiceStatus,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    lineType: 'MRC',
    description: `Abonnement mensuel ${input.provider} (MRC)`,
    quantity: '1.000000',
    unit: 'month',
    amount: input.mrcAmount,
    currency: input.mrcCurrency,
    sourceDocument: input.invoiceDocument,
    sourceDocumentSha256: input.invoiceDocumentSha256,
    reconciliationReportHash: input.reconciliationReportHash,
    accountingStatus: input.importReceipt ? 'IMPORTED' : 'READY_FOR_IMPORT',
  };
}

export function buildAccountingPackageManifest(
  input: AccountingPackageInput,
  files: {
    readonly usageExportFile: string;
    readonly vendorInvoiceFile: string;
    readonly reconciliationFile: string;
    readonly invoiceDocumentFile: string;
  },
): AccountingPackageManifest {
  assert(MONTH_PATTERN.test(input.month), 'month must use YYYY-MM');
  assertCounts(input.reconciliationCounts);
  assert(SHA256_PATTERN.test(input.vendorInvoiceSha256 ?? ''), 'vendorInvoiceSha256 is invalid');
  const importReceipt = input.importReceipt?.trim() || null;
  const status = importReceipt ? 'IMPORTED' : 'READY_FOR_IMPORT';
  const material = stablePackageMaterial(input);
  const packageId = `sokar-accounting-${input.month}-${sha256Hex(material).slice(0, 16)}`;
  return {
    schemaVersion: 1,
    packageId,
    generatedAt: new Date().toISOString(),
    month: input.month,
    provider: input.provider,
    destination: { type: 'file', status, importReceipt },
    usageExport: { file: files.usageExportFile, currency: 'EUR', sha256: input.usageExportSha256 },
    vendorInvoice: {
      file: files.vendorInvoiceFile,
      sha256: input.vendorInvoiceSha256 ?? '',
      invoiceId: input.invoiceId,
      invoiceStatus: input.invoiceStatus,
      mrc: { amount: input.mrcAmount, currency: input.mrcCurrency, unit: 'month' },
      sourceDocument: files.invoiceDocumentFile,
      sourceDocumentSha256: input.invoiceDocumentSha256,
    },
    reconciliation: {
      file: files.reconciliationFile,
      reportHash: input.reconciliationReportHash,
      counts: input.reconciliationCounts,
      sha256: input.reconciliationFileSha256,
    },
  };
}

export function serializeAccountingPackageManifest(manifest: AccountingPackageManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
