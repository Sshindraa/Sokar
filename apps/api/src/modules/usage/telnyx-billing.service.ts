import { createHash } from 'node:crypto';
import { Prisma, type UsageCategory } from '@prisma/client';
import { telnyxFetch } from '../../shared/telnyx/http-agent';
import {
  USAGE_INVOICE_IMPORT_COLUMNS,
  type UsageInvoiceImportRow,
} from './usage-reconciliation.service';

/** A path-only fetcher keeps tests deterministic and prevents endpoint injection. */
export type TelnyxPathFetcher = (path: string, init?: RequestInit) => Promise<Response>;
export type TelnyxInvoiceFileFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface TelnyxUsageReportRow {
  readonly [key: string]: unknown;
}

export interface TelnyxUsageReportMeta {
  readonly pageSize: number;
  readonly pageNumber: number;
  readonly totalResults: number;
  readonly totalPages: number;
}

export interface TelnyxUsageReport {
  readonly product: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly data: readonly TelnyxUsageReportRow[];
  readonly meta: TelnyxUsageReportMeta;
}

export interface TelnyxInvoiceSummary {
  readonly invoiceId: string;
  readonly fileId: string | null;
  /** Telnyx returns invoice period_end as an inclusive calendar date. */
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly paid: boolean | null;
  readonly url: string | null;
}

export interface TelnyxInvoice extends TelnyxInvoiceSummary {
  /** Signed URL returned by Telnyx. Never log or persist this value. */
  readonly downloadUrl: string | null;
}

export type TelnyxBillingErrorCode =
  | 'INVALID_INPUT'
  | 'CONFIGURATION'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE';

/** Errors deliberately omit provider response bodies and credentials. */
export class TelnyxBillingError extends Error {
  constructor(
    readonly code: TelnyxBillingErrorCode,
    message: string,
    readonly status?: number,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'TelnyxBillingError';
  }
}

export const TELNYX_USAGE_PRODUCT_MAPPINGS = {
  messaging: {
    category: 'SMS_SEGMENTS' as const,
    unit: 'segments',
    defaultQuantityMetric: 'parts',
  },
  'call-control': {
    category: 'TELEPHONY_SECONDS' as const,
    unit: 'seconds',
    defaultQuantityMetric: 'billed_sec',
  },
  'sip-trunking': {
    category: 'TELEPHONY_SECONDS' as const,
    unit: 'seconds',
    defaultQuantityMetric: 'billed_sec',
  },
} as const satisfies Record<
  string,
  {
    readonly category: UsageCategory;
    readonly unit: string;
    readonly defaultQuantityMetric: string;
  }
>;

const MAX_REPORT_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 1000;
const MAX_PAGES = 1000;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const INVOICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const METRIC_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
const PRODUCT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_INVOICE_FILE_BYTES = 50 * 1024 * 1024;
const TELNYX_STORAGE_HOST_PATTERN = /(?:^|\.)telnyxstorage\.com$/;
const TELNYX_S3_STORAGE_HOST_PATTERN = /^s3\.us-east-\d+\.amazonaws\.com$/;

function invalidInput(message: string): TelnyxBillingError {
  return new TelnyxBillingError('INVALID_INPUT', message);
}

function configurationError(message: string): TelnyxBillingError {
  return new TelnyxBillingError('CONFIGURATION', message);
}

function validateApiKey(apiKey: string): string {
  const normalized = apiKey.trim();
  if (!normalized) throw configurationError('TELNYX_API_KEY is required for billing reads');
  return normalized;
}

function validatePageSize(pageSize: number | undefined): number {
  const normalized = pageSize ?? DEFAULT_PAGE_SIZE;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > DEFAULT_PAGE_SIZE) {
    throw invalidInput(`pageSize must be an integer between 1 and ${DEFAULT_PAGE_SIZE}`);
  }
  return normalized;
}

function validateMaxPages(maxPages: number | undefined): number {
  const normalized = maxPages ?? MAX_PAGES;
  if (!Number.isSafeInteger(normalized) || normalized < 1 || normalized > MAX_PAGES) {
    throw invalidInput(`maxPages must be an integer between 1 and ${MAX_PAGES}`);
  }
  return normalized;
}

function parseDate(value: Date | string, field: string): Date {
  const raw = typeof value === 'string' ? value.trim() : null;
  const parsed =
    value instanceof Date
      ? new Date(value.getTime())
      : raw && DATE_ONLY_PATTERN.test(raw)
        ? new Date(`${raw}T00:00:00.000Z`)
        : new Date(value);
  if (Number.isNaN(parsed.getTime())) throw invalidInput(`${field} must be a valid date`);
  if (raw && DATE_ONLY_PATTERN.test(raw) && parsed.toISOString().slice(0, 10) !== raw) {
    throw invalidInput(`${field} must be a valid calendar date`);
  }
  return parsed;
}

function formatTelnyxDate(value: Date): string {
  return value.toISOString().replace(/\.000Z$/, 'Z');
}

function reportWindow(input: {
  readonly startDate: Date | string;
  readonly endDate: Date | string;
}): {
  readonly start: Date;
  readonly end: Date;
  readonly startText: string;
  readonly endText: string;
} {
  const start = parseDate(input.startDate, 'startDate');
  const end = parseDate(input.endDate, 'endDate');
  if (end <= start) throw invalidInput('endDate must be later than startDate');
  if (end.getTime() - start.getTime() > MAX_REPORT_RANGE_MS) {
    throw invalidInput('Telnyx usage reports support a maximum range of 31 days');
  }
  return {
    start,
    end,
    startText: formatTelnyxDate(start),
    endText: formatTelnyxDate(end),
  };
}

function validateMetric(metric: string, field: string): string {
  const normalized = metric.trim();
  if (!METRIC_PATTERN.test(normalized)) throw invalidInput(`${field} contains an invalid metric`);
  return normalized;
}

function validateMetrics(metrics: readonly string[]): string[] {
  const normalized = metrics.map((metric) => validateMetric(metric, 'metrics'));
  if (normalized.length === 0) throw invalidInput('metrics must contain at least one metric');
  if (new Set(normalized).size !== normalized.length) throw invalidInput('metrics must be unique');
  return normalized;
}

function validateDimensions(dimensions: readonly string[] | undefined): string[] {
  const normalized = (dimensions ?? []).map((dimension) => validateMetric(dimension, 'dimensions'));
  if (new Set(normalized).size !== normalized.length)
    throw invalidInput('dimensions must be unique');
  return normalized;
}

function validateProduct(product: string): string {
  const normalized = product.trim().toLowerCase();
  if (!PRODUCT_PATTERN.test(normalized)) throw invalidInput('product contains invalid characters');
  return normalized;
}

function appendFilters(
  params: URLSearchParams,
  filters: Readonly<Record<string, string | readonly string[]>> | undefined,
): void {
  if (!filters) return;
  for (const key of Object.keys(filters).sort()) {
    if (!METRIC_PATTERN.test(key)) throw invalidInput(`filter key is invalid: ${key}`);
    const values = Array.isArray(filters[key]) ? filters[key] : [filters[key]];
    for (const value of values) {
      const normalized = String(value).trim();
      if (!normalized || normalized.length > 256) throw invalidInput(`filter ${key} is invalid`);
      params.append(`filter[${key}]`, normalized);
    }
  }
}

function usageReportPath(input: {
  readonly product: string;
  readonly startText: string;
  readonly endText: string;
  readonly metrics: readonly string[];
  readonly dimensions: readonly string[];
  readonly filters?: Readonly<Record<string, string | readonly string[]>>;
  readonly pageNumber: number;
  readonly pageSize: number;
}): string {
  const params = new URLSearchParams();
  params.set('product', input.product);
  params.set('start_date', input.startText);
  params.set('end_date', input.endText);
  params.set('metrics', input.metrics.join(','));
  if (input.dimensions.length > 0) params.set('dimensions', input.dimensions.join(','));
  appendFilters(params, input.filters);
  params.set('page[number]', String(input.pageNumber));
  params.set('page[size]', String(input.pageSize));
  return `/v2/usage_reports?${params.toString()}`;
}

function invoicesPath(pageNumber: number, pageSize: number): string {
  const params = new URLSearchParams();
  params.set('sort', '-period_start');
  params.set('page[number]', String(pageNumber));
  params.set('page[size]', String(pageSize));
  return `/v2/invoices?${params.toString()}`;
}

function responseObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned an invalid response for ${path}`,
      undefined,
      path,
    );
  }
  return value as Record<string, unknown>;
}

function responseArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned an invalid response for ${path}`,
      undefined,
      path,
    );
  }
  return value;
}

function numberField(value: unknown, fallback: number, field: string, path: string): number {
  const candidate = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned an invalid ${field} for ${path}`,
      undefined,
      path,
    );
  }
  return candidate;
}

function usageMeta(value: unknown, path: string, fallbackRows: number): TelnyxUsageReportMeta {
  const raw =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const pageSize = numberField(raw.page_size, fallbackRows, 'page_size', path);
  const pageNumber = numberField(raw.page_number, 1, 'page_number', path);
  const totalResults = numberField(raw.total_results, fallbackRows, 'total_results', path);
  const totalPages = Math.max(1, numberField(raw.total_pages, 1, 'total_pages', path));
  if (pageNumber < 1 || totalPages < pageNumber) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned invalid pagination for ${path}`,
      undefined,
      path,
    );
  }
  return { pageSize, pageNumber, totalResults, totalPages };
}

async function requestJson(
  path: string,
  apiKey: string,
  fetcher: TelnyxPathFetcher,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
    });
  } catch {
    throw new TelnyxBillingError(
      'HTTP_ERROR',
      `Telnyx request failed for ${path}`,
      undefined,
      path,
    );
  }

  if (!response.ok) {
    throw new TelnyxBillingError(
      'HTTP_ERROR',
      `Telnyx request failed for ${path} (HTTP ${response.status})`,
      response.status,
      path,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned invalid JSON for ${path}`,
      response.status,
      path,
    );
  }
  return body;
}

export interface FetchTelnyxUsageReportInput {
  readonly apiKey: string;
  readonly product: string;
  readonly startDate: Date | string;
  readonly endDate: Date | string;
  readonly metrics: readonly string[];
  readonly dimensions?: readonly string[];
  readonly filters?: Readonly<Record<string, string | readonly string[]>>;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly fetcher?: TelnyxPathFetcher;
}

/** Fetch one bounded Telnyx usage report, following all returned pages. */
export async function fetchTelnyxUsageReport(
  input: FetchTelnyxUsageReportInput,
): Promise<TelnyxUsageReport> {
  const apiKey = validateApiKey(input.apiKey);
  const product = validateProduct(input.product);
  const window = reportWindow(input);
  const metrics = validateMetrics(input.metrics);
  const dimensions = validateDimensions(input.dimensions);
  const pageSize = validatePageSize(input.pageSize);
  const maxPages = validateMaxPages(input.maxPages);
  const fetcher = input.fetcher ?? telnyxFetch;
  const data: TelnyxUsageReportRow[] = [];
  let meta: TelnyxUsageReportMeta | undefined;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const path = usageReportPath({
      product,
      startText: window.startText,
      endText: window.endText,
      metrics,
      dimensions,
      filters: input.filters,
      pageNumber,
      pageSize,
    });
    const payload = responseObject(await requestJson(path, apiKey, fetcher), path);
    const pageRows = responseArray(payload.data, path);
    for (const row of pageRows) data.push(responseObject(row, path));
    const pageMeta = usageMeta(payload.meta, path, pageRows.length);
    meta ??= pageMeta;
    if (pageNumber >= meta.totalPages) {
      return {
        product,
        startDate: window.startText,
        endDate: window.endText,
        data,
        meta: {
          pageSize: meta.pageSize,
          pageNumber: 1,
          totalResults: meta.totalResults,
          totalPages: meta.totalPages,
        },
      };
    }
    if (pageNumber === maxPages) {
      throw invalidInput(`Telnyx usage report exceeds the ${maxPages}-page safety limit`);
    }
  }
  throw invalidInput('Telnyx usage report pagination did not complete');
}

function invoiceDate(value: unknown, field: string, path: string): string {
  if (typeof value !== 'string' || !DATE_ONLY_PATTERN.test(value)) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned an invalid ${field} for ${path}`,
      undefined,
      path,
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned an invalid ${field} for ${path}`,
      undefined,
      path,
    );
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function parseInvoice(value: unknown, path: string): TelnyxInvoice {
  const raw = responseObject(value, path);
  const invoiceId = optionalString(raw.invoice_id);
  if (!invoiceId || !INVOICE_ID_PATTERN.test(invoiceId)) {
    throw new TelnyxBillingError(
      'INVALID_RESPONSE',
      `Telnyx returned an invalid invoice_id for ${path}`,
      undefined,
      path,
    );
  }
  const paid = raw.paid === undefined || raw.paid === null ? null : Boolean(raw.paid);
  return {
    invoiceId,
    fileId: optionalString(raw.file_id),
    periodStart: invoiceDate(raw.period_start, 'period_start', path),
    periodEnd: invoiceDate(raw.period_end, 'period_end', path),
    paid,
    url: optionalString(raw.url),
    downloadUrl: optionalString(raw.download_url),
  };
}

export interface ListTelnyxInvoicesInput {
  readonly apiKey: string;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly fetcher?: TelnyxPathFetcher;
}

/** List Telnyx invoices without downloading or exposing signed invoice files. */
export async function listTelnyxInvoices(
  input: ListTelnyxInvoicesInput,
): Promise<readonly TelnyxInvoiceSummary[]> {
  const apiKey = validateApiKey(input.apiKey);
  const pageSize = validatePageSize(input.pageSize);
  const maxPages = validateMaxPages(input.maxPages);
  const fetcher = input.fetcher ?? telnyxFetch;
  const invoices: TelnyxInvoiceSummary[] = [];
  let totalPages: number | undefined;
  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber++) {
    const path = invoicesPath(pageNumber, pageSize);
    const payload = responseObject(await requestJson(path, apiKey, fetcher), path);
    const rows = responseArray(payload.data, path);
    for (const row of rows) invoices.push(parseInvoice(row, path));
    const pageMeta = usageMeta(payload.meta, path, rows.length);
    totalPages ??= pageMeta.totalPages;
    if (pageNumber >= totalPages) return invoices;
    if (pageNumber === maxPages) {
      throw invalidInput(`Telnyx invoice list exceeds the ${maxPages}-page safety limit`);
    }
  }
  throw invalidInput('Telnyx invoice pagination did not complete');
}

export async function fetchTelnyxInvoice(input: {
  readonly apiKey: string;
  readonly invoiceId: string;
  readonly fetcher?: TelnyxPathFetcher;
}): Promise<TelnyxInvoice> {
  const apiKey = validateApiKey(input.apiKey);
  const invoiceId = input.invoiceId.trim();
  if (!INVOICE_ID_PATTERN.test(invoiceId))
    throw invalidInput('invoiceId contains invalid characters');
  // `action=link` is the documented invoice action that returns the
  // short-lived object-storage URL needed to download the invoice file. The
  // JSON action only returns metadata on some accounts (including production),
  // so using it here would make a real invoice impossible to retrieve.
  const path = `/v2/invoices/${encodeURIComponent(invoiceId)}?action=link`;
  const payload = responseObject(
    await requestJson(path, apiKey, input.fetcher ?? telnyxFetch),
    path,
  );
  return parseInvoice(payload.data, path);
}

/**
 * Download the short-lived invoice file returned by Telnyx.
 *
 * The URL is accepted only from Telnyx's HTTPS object-storage host. The
 * caller receives bytes and a hash; the signed URL is never returned or logged
 * by this helper.
 */
export async function downloadTelnyxInvoice(input: {
  readonly invoice: TelnyxInvoice;
  readonly fetcher?: TelnyxInvoiceFileFetcher;
}): Promise<{
  readonly bytes: Uint8Array;
  readonly sha256: string;
  readonly contentType: string | null;
}> {
  const downloadUrl = input.invoice.downloadUrl;
  if (!downloadUrl) throw invalidInput('Telnyx invoice does not provide a download_url');
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(downloadUrl);
  } catch {
    throw invalidInput('Telnyx invoice download_url is invalid');
  }
  const host = parsedUrl.hostname.toLowerCase();
  if (
    parsedUrl.protocol !== 'https:' ||
    (!TELNYX_STORAGE_HOST_PATTERN.test(host) && !TELNYX_S3_STORAGE_HOST_PATTERN.test(host))
  ) {
    throw invalidInput('Telnyx invoice download_url must use Telnyx HTTPS storage');
  }
  const fetcher = input.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(downloadUrl, { method: 'GET', redirect: 'error' });
  } catch {
    throw new TelnyxBillingError('HTTP_ERROR', 'Telnyx invoice download failed');
  }
  if (!response.ok) {
    throw new TelnyxBillingError(
      'HTTP_ERROR',
      `Telnyx invoice download failed (HTTP ${response.status})`,
      response.status,
    );
  }
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_INVOICE_FILE_BYTES) {
    throw invalidInput('Telnyx invoice file exceeds the 50 MiB safety limit');
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new TelnyxBillingError('INVALID_RESPONSE', 'Telnyx invoice file could not be read');
  }
  if (bytes.length === 0)
    throw new TelnyxBillingError('INVALID_RESPONSE', 'Telnyx invoice file is empty');
  if (bytes.length > MAX_INVOICE_FILE_BYTES) {
    throw invalidInput('Telnyx invoice file exceeds the 50 MiB safety limit');
  }
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: response.headers.get('content-type'),
  };
}

function providerDecimal(value: unknown, field: string): Prisma.Decimal {
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!DECIMAL_PATTERN.test(raw))
    throw invalidInput(`Telnyx usage field ${field} must be a non-negative decimal`);
  const parsed = new Prisma.Decimal(raw);
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw invalidInput(`Telnyx usage field ${field} must be finite and non-negative`);
  }
  return parsed;
}

function reportDate(value: string, field: string): Date {
  const parsed = parseDate(value, field);
  if (parsed.toISOString().slice(0, 10) !== value.slice(0, 10)) {
    throw invalidInput(`Telnyx report ${field} is not a stable UTC date`);
  }
  return parsed;
}

function usageCurrency(row: TelnyxUsageReportRow): string | null {
  const value = row.currency;
  return typeof value === 'string' && value.trim() ? value.trim().toUpperCase() : null;
}

export interface TelnyxUsageInvoiceRowsInput {
  readonly report: Pick<TelnyxUsageReport, 'product' | 'startDate' | 'endDate' | 'data'>;
  readonly currency: 'EUR';
  readonly quantityMetric?: string;
  readonly source: string;
  /** Keep true so a report cannot be mistaken for EUR when no currency dimension was requested. */
  readonly requireCurrencyDimension?: boolean;
  /** Explicitly represent a provider report with zero rows as zero usage. */
  readonly allowEmpty?: boolean;
}

/** Convert a Telnyx report into the exact rows consumed by the reconciliation parser. */
export function telnyxUsageReportToInvoiceRows(
  input: TelnyxUsageInvoiceRowsInput,
): UsageInvoiceImportRow[] {
  const product = validateProduct(input.report.product);
  const mapping =
    TELNYX_USAGE_PRODUCT_MAPPINGS[product as keyof typeof TELNYX_USAGE_PRODUCT_MAPPINGS];
  if (!mapping) {
    throw invalidInput(`Telnyx product ${product} has no Sokar usage mapping yet`);
  }
  const quantityMetric = validateMetric(
    input.quantityMetric ?? mapping.defaultQuantityMetric,
    'quantityMetric',
  );
  const source = input.source.trim();
  if (!source || source.length > 191)
    throw invalidInput('source must contain between 1 and 191 characters');
  const periodStart = reportDate(input.report.startDate, 'startDate');
  const periodEnd = reportDate(input.report.endDate, 'endDate');
  if (periodEnd <= periodStart)
    throw invalidInput('Telnyx report endDate must be later than startDate');
  if (input.report.data.length === 0) {
    if (!input.allowEmpty) throw invalidInput('Telnyx usage report contains no data rows');
    return [
      {
        rowNumber: 1,
        category: mapping.category,
        provider: 'telnyx',
        unit: mapping.unit,
        periodStart,
        periodEnd,
        billedQuantity: '0.000000',
        billedCostEur: '0.000000',
        currency: input.currency,
        source,
      },
    ];
  }

  const currencies = new Set<string>();
  let quantity = new Prisma.Decimal(0);
  let cost = new Prisma.Decimal(0);
  let missingCurrency = false;
  for (const row of input.report.data) {
    if (typeof row.product === 'string' && validateProduct(row.product) !== product) {
      throw invalidInput('Telnyx usage report contains a row for a different product');
    }
    const rowCurrency = usageCurrency(row);
    if (!rowCurrency) missingCurrency = true;
    else currencies.add(rowCurrency);
    quantity = quantity.add(providerDecimal(row[quantityMetric], quantityMetric));
    cost = cost.add(providerDecimal(row.cost, 'cost'));
  }
  if (currencies.size > 1) throw invalidInput('Telnyx usage report contains multiple currencies');
  if (currencies.size === 1 && !currencies.has(input.currency)) {
    throw invalidInput(
      `Telnyx usage currency is ${[...currencies][0]}, expected ${input.currency}`,
    );
  }
  if (input.requireCurrencyDimension !== false && missingCurrency) {
    throw invalidInput(
      'Telnyx usage report is missing the currency dimension; request dimensions=currency',
    );
  }

  return [
    {
      rowNumber: 1,
      category: mapping.category,
      provider: 'telnyx',
      unit: mapping.unit,
      periodStart,
      periodEnd,
      billedQuantity: quantity.toFixed(6),
      billedCostEur: cost.toFixed(6),
      currency: input.currency,
      source,
    },
  ];
}

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function serializableRow(row: UsageInvoiceImportRow): Record<string, string> {
  return {
    category: row.category,
    provider: row.provider,
    unit: row.unit,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    billedQuantity: row.billedQuantity,
    billedCostEur: row.billedCostEur,
    currency: row.currency,
    source: row.source,
  };
}

export function serializeTelnyxInvoiceRows(
  rows: readonly UsageInvoiceImportRow[],
  format: 'csv' | 'json',
): string {
  const serializable = rows.map(serializableRow);
  if (format === 'json') return `${JSON.stringify(serializable, null, 2)}\n`;
  const header = USAGE_INVOICE_IMPORT_COLUMNS.map(csvCell).join(',');
  const body = serializable.map((row) =>
    USAGE_INVOICE_IMPORT_COLUMNS.map((column) => csvCell(row[column])).join(','),
  );
  return `${[header, ...body].join('\n')}\n`;
}

export interface TelnyxUsageSnapshotHashInput {
  readonly report: Pick<TelnyxUsageReport, 'product' | 'startDate' | 'endDate' | 'data'>;
  readonly quantityMetric: string;
}

export function hashTelnyxUsageSnapshots(input: {
  readonly reports: readonly TelnyxUsageSnapshotHashInput[];
  readonly currency: 'EUR';
  readonly source: string;
  readonly invoiceId?: string | null;
}): string {
  const reports = input.reports.map(({ report, quantityMetric }) => ({
    product: report.product,
    startDate: report.startDate,
    endDate: report.endDate,
    quantityMetric,
    rows: report.data.map((row) => {
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(row).sort()) normalized[key] = row[key];
      return normalized;
    }),
  }));
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        provider: 'telnyx',
        currency: input.currency,
        source: input.source,
        invoiceId: input.invoiceId ?? null,
        reports,
      }),
    )
    .digest('hex');
}

export function hashTelnyxUsageSnapshot(input: {
  readonly report: Pick<TelnyxUsageReport, 'product' | 'startDate' | 'endDate' | 'data'>;
  readonly quantityMetric: string;
  readonly currency: 'EUR';
  readonly source: string;
  readonly invoiceId?: string | null;
}): string {
  return hashTelnyxUsageSnapshots({
    reports: [{ report: input.report, quantityMetric: input.quantityMetric }],
    currency: input.currency,
    source: input.source,
    invoiceId: input.invoiceId,
  });
}
