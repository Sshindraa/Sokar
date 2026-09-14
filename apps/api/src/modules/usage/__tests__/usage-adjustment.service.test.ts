import { Prisma, UsageAdjustmentStatus, type UsageReconciliationAdjustment } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import {
  UsageAdjustmentConflictError,
  UsageAdjustmentInputError,
  UsageAdjustmentStateError,
  adjustmentIdempotencyKey,
  decideUsageAdjustment,
  recordUsageAdjustment,
} from '../usage-adjustment.service';

const INPUT = {
  reportHash: 'a'.repeat(64),
  evidenceRef: 'vault://invoices/telnyx-2026-09.json',
  scopeKey: 'restaurant:rest-1',
  restaurantId: 'rest-1',
  category: 'SMS_SEGMENTS' as const,
  provider: 'Telnyx',
  unit: 'Segments',
  periodStart: new Date('2026-09-01T00:00:00.000Z'),
  periodEnd: new Date('2026-10-01T00:00:00.000Z'),
  quantityDelta: '-2',
  costDeltaEur: '0.015',
  reason: 'Provider invoice includes two rejected segments.',
  createdByHash: 'b'.repeat(64),
};

function adjustment(overrides: Partial<UsageReconciliationAdjustment> = {}) {
  const normalized = {
    ...INPUT,
    provider: INPUT.provider.toLowerCase(),
    unit: INPUT.unit.toLowerCase(),
  };
  const idempotencyKey = adjustmentIdempotencyKey(normalized);
  return {
    id: 'adjustment-1',
    idempotencyKey,
    reportHash: INPUT.reportHash,
    evidenceRef: INPUT.evidenceRef,
    scopeKey: INPUT.scopeKey,
    restaurantId: INPUT.restaurantId,
    category: INPUT.category,
    provider: normalized.provider,
    unit: normalized.unit,
    periodStart: INPUT.periodStart,
    periodEnd: INPUT.periodEnd,
    quantityDelta: new Prisma.Decimal(INPUT.quantityDelta),
    costDeltaEur: new Prisma.Decimal(INPUT.costDeltaEur),
    status: UsageAdjustmentStatus.OPEN,
    reason: INPUT.reason,
    decisionReason: null,
    createdByHash: INPUT.createdByHash,
    decidedByHash: null,
    decidedAt: null,
    createdAt: new Date('2026-09-14T12:00:00.000Z'),
    updatedAt: new Date('2026-09-14T12:00:00.000Z'),
    ...overrides,
  } satisfies UsageReconciliationAdjustment;
}

describe('usage reconciliation adjustments', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a normalized, signed adjustment with a stable idempotency key', async () => {
    vi.mocked(db.usageReconciliationAdjustment.findUnique).mockResolvedValue(null);
    vi.mocked(db.usageReconciliationAdjustment.create).mockResolvedValue(adjustment());

    const result = await recordUsageAdjustment(INPUT);

    expect(result.created).toBe(true);
    expect(db.usageReconciliationAdjustment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'telnyx',
        unit: 'segments',
        quantityDelta: new Prisma.Decimal('-2'),
        costDeltaEur: new Prisma.Decimal('0.015'),
        status: UsageAdjustmentStatus.OPEN,
      }),
    });
  });

  it('returns an exact replay and rejects changed evidence under the same key', async () => {
    vi.mocked(db.usageReconciliationAdjustment.findUnique).mockResolvedValue(adjustment());

    await expect(recordUsageAdjustment(INPUT)).resolves.toEqual({
      adjustment: adjustment(),
      created: false,
    });
    await expect(
      recordUsageAdjustment({ ...INPUT, reason: 'Changed after review.' }),
    ).rejects.toBeInstanceOf(UsageAdjustmentConflictError);
  });

  it('rejects an invalid scope or an empty correction', async () => {
    await expect(recordUsageAdjustment({ ...INPUT, scopeKey: 'global' })).rejects.toBeInstanceOf(
      UsageAdjustmentInputError,
    );
    await expect(
      recordUsageAdjustment({ ...INPUT, quantityDelta: 0, costDeltaEur: 0 }),
    ).rejects.toBeInstanceOf(UsageAdjustmentInputError);
  });

  it('approves an open adjustment with an atomic status predicate', async () => {
    vi.mocked(db.usageReconciliationAdjustment.findUnique)
      .mockResolvedValueOnce(adjustment())
      .mockResolvedValueOnce(
        adjustment({
          status: UsageAdjustmentStatus.APPROVED,
          decisionReason: 'Validated against provider invoice.',
          decidedByHash: 'c'.repeat(64),
          decidedAt: new Date('2026-09-14T12:05:00.000Z'),
        }),
      );
    vi.mocked(db.usageReconciliationAdjustment.updateMany).mockResolvedValue({ count: 1 });

    const result = await decideUsageAdjustment({
      id: 'adjustment-1',
      status: UsageAdjustmentStatus.APPROVED,
      reason: 'Validated against provider invoice.',
      decidedByHash: 'c'.repeat(64),
    });

    expect(result.status).toBe(UsageAdjustmentStatus.APPROVED);
    expect(db.usageReconciliationAdjustment.updateMany).toHaveBeenCalledWith({
      where: { id: 'adjustment-1', status: UsageAdjustmentStatus.OPEN },
      data: expect.objectContaining({
        status: UsageAdjustmentStatus.APPROVED,
        decisionReason: 'Validated against provider invoice.',
      }),
    });
  });

  it('does not overwrite a concurrent decision', async () => {
    vi.mocked(db.usageReconciliationAdjustment.findUnique)
      .mockResolvedValueOnce(adjustment())
      .mockResolvedValueOnce(adjustment({ status: UsageAdjustmentStatus.REJECTED }));
    vi.mocked(db.usageReconciliationAdjustment.updateMany).mockResolvedValue({ count: 0 });

    await expect(
      decideUsageAdjustment({
        id: 'adjustment-1',
        status: UsageAdjustmentStatus.APPROVED,
        reason: 'Approve',
        decidedByHash: 'c'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(UsageAdjustmentStateError);
  });
});
