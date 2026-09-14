import { describe, expect, it, vi } from 'vitest';
import {
  fetchTelnyxInvoice,
  fetchTelnyxUsageReport,
  hashTelnyxUsageSnapshot,
  listTelnyxInvoices,
  downloadTelnyxInvoice,
  serializeTelnyxInvoiceRows,
  TelnyxBillingError,
  telnyxUsageReportToInvoiceRows,
  type TelnyxInvoiceFileFetcher,
  type TelnyxPathFetcher,
} from '../telnyx-billing.service';
import { parseUsageInvoiceImport } from '../usage-reconciliation.service';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetcherFor(...responses: Response[]): ReturnType<typeof vi.fn<TelnyxPathFetcher>> {
  const calls = [...responses];
  return vi.fn<TelnyxPathFetcher>(
    async () => calls.shift() ?? jsonResponse({ data: [], meta: {} }),
  );
}

describe('Telnyx billing connector', () => {
  it('fetches every usage page with bearer auth and bounded UTC parameters', async () => {
    const fetcher = vi
      .fn<TelnyxPathFetcher>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ currency: 'EUR', parts: 2, cost: 0.12 }],
          meta: { page_size: 1, page_number: 1, total_results: 2, total_pages: 2 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ currency: 'EUR', parts: 3, cost: '0.18' }],
          meta: { page_size: 1, page_number: 2, total_results: 2, total_pages: 2 },
        }),
      );

    const report = await fetchTelnyxUsageReport({
      apiKey: 'fixture',
      product: 'messaging',
      startDate: '2026-09-01',
      endDate: '2026-10-01',
      metrics: ['cost', 'parts'],
      dimensions: ['currency'],
      pageSize: 1,
      fetcher,
    });

    expect(report.data).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const firstCall = fetcher.mock.calls[0]!;
    expect(firstCall[1]).toMatchObject({
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: 'Bearer fixture',
      },
    });
    const firstUrl = new URL(`https://telnyx.test${firstCall[0]}`);
    expect(firstUrl.searchParams.get('product')).toBe('messaging');
    expect(firstUrl.searchParams.get('start_date')).toBe('2026-09-01T00:00:00Z');
    expect(firstUrl.searchParams.get('end_date')).toBe('2026-10-01T00:00:00Z');
    expect(firstUrl.searchParams.get('page[number]')).toBe('1');
    expect(firstUrl.searchParams.get('page[size]')).toBe('1');
  });

  it('rejects missing credentials and report windows longer than Telnyx allows', async () => {
    await expect(
      fetchTelnyxUsageReport({
        apiKey: ' ',
        product: 'messaging',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        metrics: ['cost', 'parts'],
        fetcher: fetcherFor(),
      }),
    ).rejects.toMatchObject({ code: 'CONFIGURATION' });

    await expect(
      fetchTelnyxUsageReport({
        apiKey: 'fixture',
        product: 'messaging',
        startDate: '2026-01-01',
        endDate: '2026-02-02',
        metrics: ['cost', 'parts'],
        fetcher: fetcherFor(),
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });

    await expect(
      fetchTelnyxUsageReport({
        apiKey: 'fixture',
        product: 'messaging',
        startDate: '2026-02-30',
        endDate: '2026-03-01',
        metrics: ['cost', 'parts'],
        fetcher: fetcherFor(),
      }),
    ).rejects.toThrow('valid calendar date');
  });

  it('does not leak the API key when Telnyx returns an HTTP error', async () => {
    const fetcher = vi
      .fn<TelnyxPathFetcher>()
      .mockResolvedValue(jsonResponse({ errors: [{ detail: 'Bearer test-secret' }] }, 403));

    const error = await fetchTelnyxUsageReport({
      apiKey: 'fixture',
      product: 'messaging',
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      metrics: ['cost', 'parts'],
      fetcher,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TelnyxBillingError);
    expect((error as Error).message).not.toContain('test-secret');
    expect(error).toMatchObject({ code: 'HTTP_ERROR', status: 403 });
  });

  it('loads invoice metadata and paginates invoice listings without downloading files', async () => {
    const invoiceFetcher = fetcherFor(
      jsonResponse({
        data: {
          invoice_id: '48eff763-ea80-4345-b688-78249eb165a8',
          file_id: 'file-1',
          period_start: '2026-09-01',
          period_end: '2026-09-30',
          paid: true,
          url: 'https://api.telnyx.com/v2/invoices/48eff763-ea80-4345-b688-78249eb165a8',
          download_url: 'https://signed.example/invoice.pdf?token=secret',
        },
      }),
    );
    const invoice = await fetchTelnyxInvoice({
      apiKey: 'fixture',
      invoiceId: '48eff763-ea80-4345-b688-78249eb165a8',
      fetcher: invoiceFetcher,
    });
    expect(invoice).toMatchObject({
      invoiceId: '48eff763-ea80-4345-b688-78249eb165a8',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
      paid: true,
    });
    expect(invoiceFetcher.mock.calls[0]?.[0]).toBe(
      '/v2/invoices/48eff763-ea80-4345-b688-78249eb165a8?action=link',
    );

    const listFetcher = fetcherFor(
      jsonResponse({
        data: [
          {
            invoice_id: 'invoice-1',
            period_start: '2026-09-01',
            period_end: '2026-09-30',
            paid: false,
          },
        ],
        meta: { page_size: 1, page_number: 1, total_results: 1, total_pages: 1 },
      }),
    );
    const invoices = await listTelnyxInvoices({ apiKey: 'fixture', fetcher: listFetcher });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.invoiceId).toBe('invoice-1');
  });

  it('downloads only Telnyx HTTPS invoice files and returns an immutable hash', async () => {
    const fileFetcher = vi.fn<TelnyxInvoiceFileFetcher>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/pdf', 'content-length': '3' }),
      arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
    } as Response);
    const result = await downloadTelnyxInvoice({
      invoice: {
        invoiceId: 'invoice-1',
        fileId: 'file-1',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        paid: true,
        url: null,
        downloadUrl: 'https://us-east-1.telnyxstorage.com/invoice.pdf?token=secret',
      },
      fetcher: fileFetcher,
    });
    expect([...result.bytes]).toEqual([1, 2, 3]);
    expect(result.sha256).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    expect(result.contentType).toBe('application/pdf');
    expect(fileFetcher).toHaveBeenCalledWith(
      'https://us-east-1.telnyxstorage.com/invoice.pdf?token=secret',
      expect.objectContaining({ method: 'GET', redirect: 'error' }),
    );
    await expect(
      downloadTelnyxInvoice({
        invoice: {
          invoiceId: 'invoice-1',
          fileId: null,
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          paid: true,
          url: null,
          downloadUrl: 'https://example.com/invoice.pdf',
        },
        fetcher: fileFetcher,
      }),
    ).rejects.toThrow(/Telnyx HTTPS storage/);

    await expect(
      downloadTelnyxInvoice({
        invoice: {
          invoiceId: 'invoice-1',
          fileId: 'file-1',
          periodStart: '2026-09-01',
          periodEnd: '2026-09-30',
          paid: true,
          url: null,
          downloadUrl:
            'https://s3.us-east-2.amazonaws.com/documents-porting/invoice.pdf?token=secret',
        },
        fetcher: fileFetcher,
      }),
    ).resolves.toMatchObject({ sha256: expect.any(String) });
  });

  it('maps a currency-verified messaging report to the reconciliation schema', () => {
    const report = {
      product: 'messaging',
      startDate: '2026-09-01T00:00:00Z',
      endDate: '2026-10-01T00:00:00Z',
      data: [
        { currency: 'EUR', parts: 2, cost: 0.12 },
        { currency: 'EUR', parts: '3', cost: '0.18' },
      ],
    } as const;
    const rows = telnyxUsageReportToInvoiceRows({
      report,
      currency: 'EUR',
      source: 'invoice:telnyx:2026-09',
    });
    expect(rows).toEqual([
      expect.objectContaining({
        category: 'SMS_SEGMENTS',
        provider: 'telnyx',
        unit: 'segments',
        billedQuantity: '5.000000',
        billedCostEur: '0.300000',
        currency: 'EUR',
      }),
    ]);

    const json = serializeTelnyxInvoiceRows(rows, 'json');
    expect(parseUsageInvoiceImport(json, 'json')).toHaveLength(1);
    expect(
      hashTelnyxUsageSnapshot({
        report,
        quantityMetric: 'parts',
        currency: 'EUR',
        source: 'invoice:telnyx:2026-09',
      }),
    ).toHaveLength(64);
  });

  it('requires an explicit opt-in before representing an empty provider report as zero usage', () => {
    const report = {
      product: 'messaging',
      startDate: '2026-08-01T00:00:00Z',
      endDate: '2026-09-01T00:00:00Z',
      data: [],
    };

    expect(() =>
      telnyxUsageReportToInvoiceRows({
        report,
        currency: 'EUR',
        source: 'invoice:telnyx:test',
      }),
    ).toThrow('no data rows');

    expect(
      telnyxUsageReportToInvoiceRows({
        report,
        currency: 'EUR',
        source: 'invoice:telnyx:test',
        allowEmpty: true,
      }),
    ).toMatchObject([
      {
        category: 'SMS_SEGMENTS',
        billedQuantity: '0.000000',
        billedCostEur: '0.000000',
      },
    ]);
  });

  it('refuses unverified or mixed currency reports and supports explicit voice metrics', () => {
    const base = {
      product: 'sip-trunking',
      startDate: '2026-09-01T00:00:00Z',
      endDate: '2026-10-01T00:00:00Z',
    } as const;
    expect(() =>
      telnyxUsageReportToInvoiceRows({
        report: { ...base, data: [{ billed_sec: 12, cost: 0.3 }] },
        currency: 'EUR',
        source: 'invoice:telnyx:2026-09',
      }),
    ).toThrow(/currency dimension/);
    expect(() =>
      telnyxUsageReportToInvoiceRows({
        report: {
          ...base,
          data: [
            { currency: 'EUR', billed_sec: 12, cost: 0.3 },
            { currency: 'USD', billed_sec: 2, cost: 0.1 },
          ],
        },
        currency: 'EUR',
        source: 'invoice:telnyx:2026-09',
      }),
    ).toThrow(/multiple currencies|expected EUR/);
    const rows = telnyxUsageReportToInvoiceRows({
      report: {
        ...base,
        data: [{ currency: 'EUR', billed_sec: 12, cost: 0.3 }],
      },
      currency: 'EUR',
      source: 'invoice:telnyx:2026-09',
    });
    expect(rows[0]?.category).toBe('TELEPHONY_SECONDS');
    expect(rows[0]?.billedQuantity).toBe('12.000000');
  });
});
