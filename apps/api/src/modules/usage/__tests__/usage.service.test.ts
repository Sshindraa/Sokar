import { Prisma, type UsageEvent } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import {
  UsageEventConflictError,
  UsageInputError,
  currentMonthKey,
  monthBounds,
  recordUsageEvent,
  rebuildMonthlyRollups,
} from '../usage.service';

const INPUT = {
  restaurantId: 'rest-1',
  accountId: 'account-1',
  category: 'TELEPHONY_SECONDS' as const,
  provider: 'telnyx',
  quantity: '61',
  unit: 'seconds',
  estimatedCostEur: '0.015250',
  sourceType: 'call',
  sourceId: 'call-1',
  sourceEventKey: 'telnyx:call:call-1:final',
  occurredAt: new Date('2026-09-13T12:00:00.000Z'),
  metadata: { priceVersion: '2026-09-01' },
};

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    id: 'usage-1',
    restaurantId: INPUT.restaurantId,
    accountId: INPUT.accountId,
    category: INPUT.category,
    provider: INPUT.provider,
    quantity: new Prisma.Decimal(INPUT.quantity),
    unit: INPUT.unit,
    estimatedCost: new Prisma.Decimal(INPUT.estimatedCostEur),
    currency: 'EUR',
    sourceType: INPUT.sourceType,
    sourceId: INPUT.sourceId,
    sourceEventKey: INPUT.sourceEventKey,
    occurredAt: INPUT.occurredAt,
    metadata: INPUT.metadata,
    createdAt: new Date('2026-09-13T12:00:01.000Z'),
    ...overrides,
  };
}

describe('usage ledger', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a normalized append-only event', async () => {
    vi.mocked(db.usageEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.usageEvent.create).mockResolvedValue(event());

    const result = await recordUsageEvent({ ...INPUT, provider: '  telnyx  ' });

    expect(result.created).toBe(true);
    expect(db.usageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'telnyx',
        sourceEventKey: INPUT.sourceEventKey,
        currency: 'EUR',
      }),
    });
  });

  it('returns the existing event for an exact replay', async () => {
    vi.mocked(db.usageEvent.findUnique).mockResolvedValue(event());
    const result = await recordUsageEvent({
      ...INPUT,
      occurredAt: new Date('2026-09-13T12:00:05.000Z'),
    });
    expect(result).toEqual({ event: event(), created: false });
    expect(db.usageEvent.create).not.toHaveBeenCalled();
  });

  it('rejects a source key reused with a different quantity', async () => {
    vi.mocked(db.usageEvent.findUnique).mockResolvedValue(event());
    await expect(recordUsageEvent({ ...INPUT, quantity: 62 })).rejects.toBeInstanceOf(
      UsageEventConflictError,
    );
  });

  it('rejects negative quantities and invalid months', async () => {
    await expect(recordUsageEvent({ ...INPUT, quantity: -1 })).rejects.toBeInstanceOf(
      UsageInputError,
    );
    expect(() => monthBounds('2026-13')).toThrow(UsageInputError);
  });

  it('uses UTC calendar months', () => {
    expect(currentMonthKey(new Date('2026-09-30T23:59:59.000Z'))).toBe('2026-09');
    expect(monthBounds('2026-09')).toEqual({
      start: new Date('2026-09-01T00:00:00.000Z'),
      end: new Date('2026-10-01T00:00:00.000Z'),
    });
  });

  it('rebuilds a month after deleting its previous projection', async () => {
    vi.mocked(db.usageEvent.groupBy).mockResolvedValue([
      {
        category: 'SMS_SEGMENTS',
        _sum: { quantity: new Prisma.Decimal(3), estimatedCost: new Prisma.Decimal('0.24') },
      },
    ] as never);

    await rebuildMonthlyRollups('rest-1', '2026-09');

    expect(db.usageMonthlyRollup.deleteMany).toHaveBeenCalledWith({
      where: { restaurantId: 'rest-1', monthKey: '2026-09' },
    });
    expect(db.usageMonthlyRollup.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        restaurantId: 'rest-1',
        monthKey: '2026-09',
        category: 'SMS_SEGMENTS',
      }),
    });
  });
});
