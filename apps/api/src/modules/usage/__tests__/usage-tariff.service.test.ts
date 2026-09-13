import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { db } from '../../../shared/db/client';
import {
  calculateUsageCost,
  recordPricedUsageEvent,
  resolveUsageTariff,
} from '../usage-tariff.service';

describe('usage tariff service', () => {
  const occurredAt = new Date('2026-09-13T12:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.usageTariff.findFirst).mockResolvedValue(null);
  });

  it('keeps a provider explicitly unpriced when no effective row exists', async () => {
    await expect(
      resolveUsageTariff({
        category: 'STT_SECONDS',
        provider: 'ElevenLabs',
        unit: 'SECONDS',
        quantity: 12,
        occurredAt,
      }),
    ).resolves.toEqual({ estimatedCostEur: '0.000000', costStatus: 'UNPRICED' });
  });

  it('selects the effective version and multiplies the precise quantity', async () => {
    vi.mocked(db.usageTariff.findFirst).mockResolvedValue({
      id: 'tariff-2',
      category: 'STT_SECONDS',
      provider: 'elevenlabs',
      unit: 'seconds',
      pricePerUnit: new Prisma.Decimal('0.0025'),
      currency: 'EUR',
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      effectiveTo: null,
      version: 2,
      source: 'vendor-invoice-2026-09',
      createdAt: occurredAt,
    } as never);

    await expect(
      resolveUsageTariff({
        category: 'STT_SECONDS',
        provider: 'ElevenLabs',
        unit: 'SECONDS',
        quantity: '12.4',
        occurredAt,
      }),
    ).resolves.toMatchObject({
      estimatedCostEur: '0.031000',
      costStatus: 'PRICED',
      tariffId: 'tariff-2',
      tariffVersion: 2,
    });
  });

  it('writes the cost status and tariff identity into the immutable event', async () => {
    vi.mocked(db.usageTariff.findFirst).mockResolvedValue({
      id: 'tariff-1',
      category: 'TTS_CHARACTERS',
      provider: 'cartesia',
      unit: 'characters',
      pricePerUnit: new Prisma.Decimal('0.0001'),
      currency: 'EUR',
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
      effectiveTo: null,
      version: 1,
      source: 'vendor-invoice-2026-09',
      createdAt: occurredAt,
    } as never);
    vi.mocked(db.usageEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.usageEvent.create).mockResolvedValue({ id: 'usage-1' } as never);

    await recordPricedUsageEvent({
      restaurantId: 'rest-1',
      category: 'TTS_CHARACTERS',
      provider: 'cartesia',
      quantity: 100,
      unit: 'characters',
      sourceType: 'voice_call',
      sourceId: 'leg-1',
      sourceEventKey: 'cartesia:tts:leg-1:final',
      occurredAt,
      metadata: { countMethod: 'provider_requests' },
    });

    expect(db.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        estimatedCost: new Prisma.Decimal('0.010000'),
        metadata: {
          countMethod: 'provider_requests',
          costStatus: 'PRICED',
          tariffId: 'tariff-1',
          tariffVersion: 1,
          tariffSource: 'vendor-invoice-2026-09',
        },
      }),
    });
  });

  it('calculates without floating point drift', () => {
    expect(calculateUsageCost('12.4', '0.0025')).toBe('0.031000');
  });
});
