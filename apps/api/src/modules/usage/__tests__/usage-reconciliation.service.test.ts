import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  hashUsageReconciliationReport,
  parseUsageInvoiceImport,
  reconcileUsageInvoice,
  type UsageInvoiceImportRow,
} from '../usage-reconciliation.service';

const header =
  'category,provider,unit,periodStart,periodEnd,billedQuantity,billedCostEur,currency,source';

function invoice(overrides: Partial<UsageInvoiceImportRow> = {}): UsageInvoiceImportRow {
  return {
    rowNumber: 2,
    category: 'SMS_SEGMENTS',
    provider: 'telnyx',
    unit: 'segments',
    periodStart: new Date('2026-09-01T00:00:00.000Z'),
    periodEnd: new Date('2026-10-01T00:00:00.000Z'),
    billedQuantity: '10.000000',
    billedCostEur: '0.075000',
    currency: 'EUR',
    source: 'invoice:telnyx:2026-09',
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    restaurantId: 'restaurant-1',
    category: 'SMS_SEGMENTS' as const,
    provider: 'telnyx',
    unit: 'segments',
    quantity: new Prisma.Decimal('10'),
    estimatedCostEur: new Prisma.Decimal('0.075'),
    occurredAt: new Date('2026-09-15T12:00:00.000Z'),
    metadata: { costStatus: 'PRICED' },
    ...overrides,
  };
}

describe('usage invoice reconciliation', () => {
  it('parses the strict CSV contract and normalizes dimensions', () => {
    const [row] = parseUsageInvoiceImport(
      `${header}\nSMS_SEGMENTS,Telnyx,SEGMENTS,2026-09-01,2026-10-01,10,0.075,EUR,invoice:telnyx:2026-09`,
    );
    expect(row).toMatchObject({
      provider: 'telnyx',
      unit: 'segments',
      billedQuantity: '10.000000',
      billedCostEur: '0.075000',
    });
  });

  it('returns MATCH for exact quantity and cost', () => {
    const report = reconcileUsageInvoice({ invoiceRows: [invoice()], usageEvents: [event()] });
    expect(report.counts).toEqual({
      MATCH: 1,
      MISMATCH: 0,
      INVOICE_ONLY: 0,
      USAGE_ONLY: 0,
      UNPRICED_USAGE: 0,
    });
  });

  it('keeps a small provider rounding difference behind an explicit tolerance', () => {
    const report = reconcileUsageInvoice({
      invoiceRows: [invoice({ billedCostEur: '0.080000' })],
      usageEvents: [event()],
      costToleranceEur: '0.005',
    });
    expect(report.rows[0]?.status).toBe('MATCH');
  });

  it('aggregates split lines for the same invoice period and dimension', () => {
    const report = reconcileUsageInvoice({
      invoiceRows: [
        invoice({ billedQuantity: '4', billedCostEur: '0.03' }),
        invoice({ rowNumber: 3, billedQuantity: '6', billedCostEur: '0.045' }),
      ],
      usageEvents: [event()],
    });
    expect(report.rows[0]).toMatchObject({ status: 'MATCH', billedQuantity: '10.000000' });
  });

  it('marks events without a resolved tariff as UNPRICED_USAGE', () => {
    const report = reconcileUsageInvoice({
      invoiceRows: [invoice({ billedQuantity: '0', billedCostEur: '0' })],
      usageEvents: [event({ estimatedCostEur: '0', metadata: { costStatus: 'UNPRICED' } })],
    });
    expect(report.rows[0]?.status).toBe('UNPRICED_USAGE');
  });

  it('matches an explicit zero-usage invoice row when the ledger has no events', () => {
    const report = reconcileUsageInvoice({
      invoiceRows: [invoice({ billedQuantity: '0', billedCostEur: '0' })],
      usageEvents: [],
    });
    expect(report.counts).toMatchObject({ MATCH: 1, INVOICE_ONLY: 0 });
    expect(report.rows[0]).toMatchObject({
      status: 'MATCH',
      observedQuantity: '0.000000',
      observedCostEur: '0.000000',
      eventCount: 0,
    });
  });

  it('reports invoice-only and usage-only dimensions without mutating input', () => {
    const report = reconcileUsageInvoice({
      invoiceRows: [invoice({ category: 'STT_SECONDS', provider: 'elevenlabs', unit: 'seconds' })],
      usageEvents: [event({ category: 'SMS_SEGMENTS' })],
    });
    expect(report.counts.INVOICE_ONLY).toBe(1);
    expect(report.counts.USAGE_ONLY).toBe(1);
  });

  it('blocks overlapping periods for the same usage dimension', () => {
    expect(() =>
      parseUsageInvoiceImport(
        `${header}\nSMS_SEGMENTS,telnyx,segments,2026-09-01,2026-09-20,1,0.01,EUR,invoice:x\nSMS_SEGMENTS,telnyx,segments,2026-09-15,2026-10-01,1,0.01,EUR,invoice:y`,
      ),
    ).toThrow(/invalid/i);
  });

  it('creates a stable report hash that ignores runtime timestamps', () => {
    const report = reconcileUsageInvoice({ invoiceRows: [invoice()], usageEvents: [event()] });
    const input = {
      report,
      scope: { start: '2026-09-01T00:00:00.000Z', end: '2026-10-01T00:00:00.000Z' },
      restaurantId: null,
      quantityTolerance: '0',
      costToleranceEur: '0',
    };
    expect(hashUsageReconciliationReport(input)).toBe(hashUsageReconciliationReport(input));
    expect(hashUsageReconciliationReport({ ...input, costToleranceEur: '0.001' })).not.toBe(
      hashUsageReconciliationReport(input),
    );
  });
});
