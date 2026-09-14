import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  parseUsageTariffImport,
  planUsageTariffImport,
  type ExistingUsageTariff,
} from '../usage-tariff-import.service';

const csvHeader =
  'category,provider,unit,pricePerUnit,currency,effectiveFrom,effectiveTo,version,source';

function existing(overrides: Partial<ExistingUsageTariff> = {}): ExistingUsageTariff {
  return {
    id: 'tariff-1',
    category: 'STT_SECONDS',
    provider: 'elevenlabs',
    unit: 'seconds',
    pricePerUnit: new Prisma.Decimal('0.002500000'),
    currency: 'EUR',
    effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    effectiveTo: null,
    version: 1,
    source: 'invoice:elevenlabs:2026-09',
    ...overrides,
  };
}

describe('usage tariff import', () => {
  it('parses quoted CSV fields and normalizes the provider dimensions', () => {
    const rows = parseUsageTariffImport(
      `${csvHeader}\nSTT_SECONDS,"Eleven, Labs",SECONDS,0.0025,EUR,2026-09-01,,1,invoice:2026-09`,
    );

    expect(rows).toMatchObject([
      {
        rowNumber: 2,
        category: 'STT_SECONDS',
        provider: 'eleven, labs',
        unit: 'seconds',
        pricePerUnit: '0.002500000',
        effectiveTo: null,
        version: 1,
      },
    ]);
  });

  it('accepts an identical row as an idempotent skip', () => {
    const [row] = parseUsageTariffImport(
      `${csvHeader}\nSTT_SECONDS,elevenlabs,seconds,0.0025,EUR,2026-09-01,,1,invoice:elevenlabs:2026-09`,
    );
    const plan = planUsageTariffImport([row!], [existing()]);

    expect(plan).toEqual({
      inserts: [],
      skips: [{ rowNumber: 2, tariffId: 'tariff-1' }],
      issues: [],
    });
  });

  it('rejects a conflicting version and overlapping effective window', () => {
    const [row] = parseUsageTariffImport(
      `${csvHeader}\nSTT_SECONDS,elevenlabs,seconds,0.003,EUR,2026-09-15,,2,invoice:elevenlabs:2026-10`,
    );
    const plan = planUsageTariffImport([row!], [existing()]);

    expect(plan.inserts).toEqual([]);
    expect(plan.issues.map((item) => item.code)).toContain('EFFECTIVE_WINDOW_OVERLAP');
  });

  it('rejects non-EUR and over-precise prices before touching the database', () => {
    expect(() =>
      parseUsageTariffImport(
        `${csvHeader}\nSTT_SECONDS,elevenlabs,seconds,0.0025000001,USD,2026-09-01,,1,invoice:bad`,
      ),
    ).toThrow(/invalid/i);
  });

  it('rejects calendar dates that JavaScript would otherwise roll over', () => {
    expect(() =>
      parseUsageTariffImport(
        `${csvHeader}\nSTT_SECONDS,elevenlabs,seconds,0.0025,EUR,2026-02-30,,1,invoice:bad-date`,
      ),
    ).toThrow(/invalid/i);
  });

  it('parses JSON rows using the same validation contract', () => {
    const [row] = parseUsageTariffImport(
      JSON.stringify([
        {
          category: 'SMS_SEGMENTS',
          provider: 'Telnyx',
          unit: 'segments',
          pricePerUnit: '0.0075',
          currency: 'EUR',
          effectiveFrom: '2026-09-01',
          effectiveTo: null,
          version: 1,
          source: 'invoice:telnyx:2026-09',
        },
      ]),
      'json',
    );

    expect(row).toMatchObject({
      provider: 'telnyx',
      unit: 'segments',
      pricePerUnit: '0.007500000',
    });
  });
});
