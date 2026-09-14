import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { importPosChecks, normalizePosCheckInput } from '../pos-sync.service';

const INPUT = {
  externalId: 'ticket-42',
  openedAt: '2026-09-14T19:00:00.000Z',
  closedAt: '2026-09-14T20:00:00.000Z',
  subtotal: '40.00',
  tax: 8,
  total: '48.00',
  currency: 'eur',
  rawPayload: { total: 48, externalId: 'ticket-42' },
};

describe('pos-sync.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes money/currency and hashes raw payload without persisting it', () => {
    const normalized = normalizePosCheckInput(INPUT);

    expect(normalized.currency).toBe('EUR');
    expect(normalized.subtotal).toEqual(new Prisma.Decimal('40.00'));
    expect(normalized.tax).toEqual(new Prisma.Decimal('8'));
    expect(normalized.rawPayloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(normalized).not.toHaveProperty('rawPayload');
  });

  it('keeps the default import dry-run read-only', async () => {
    vi.mocked(db.posConnection.findFirst).mockResolvedValue({
      id: 'connection-1',
      status: 'PENDING',
    } as never);

    const result = await importPosChecks({
      restaurantId: 'restaurant-1',
      connectionId: 'connection-1',
      checks: [INPUT],
    });

    expect(result.dryRun).toBe(true);
    expect(result.processedCount).toBe(1);
    expect(db.posCheck.upsert).not.toHaveBeenCalled();
    expect(db.posConnection.update).not.toHaveBeenCalled();
  });

  it('upserts a committed page and advances health only after the transaction', async () => {
    vi.mocked(db.posConnection.findFirst).mockResolvedValue({
      id: 'connection-1',
      status: 'PENDING',
    } as never);
    vi.mocked(db.posCheck.upsert).mockResolvedValue({
      id: 'check-1',
      connectionId: 'connection-1',
      externalId: 'ticket-42',
      externalRevision: null,
      openedAt: new Date(INPUT.openedAt),
      closedAt: new Date(INPUT.closedAt),
      tableReference: null,
      subtotal: new Prisma.Decimal('40.00'),
      tax: new Prisma.Decimal('8.00'),
      tip: new Prisma.Decimal('0.00'),
      discount: new Prisma.Decimal('0.00'),
      total: new Prisma.Decimal('48.00'),
      refundedAmount: new Prisma.Decimal('0.00'),
      currency: 'EUR',
      rawPayloadHash: 'a'.repeat(64),
      importedAt: new Date(INPUT.openedAt),
      updatedAt: new Date(INPUT.openedAt),
    } as never);

    const result = await importPosChecks({
      restaurantId: 'restaurant-1',
      connectionId: 'connection-1',
      checks: [INPUT],
      dryRun: false,
      nextCursor: 'cursor-2',
    });

    expect(result).toMatchObject({ dryRun: false, processedCount: 1, nextCursor: 'cursor-2' });
    expect(result.checks[0]).toMatchObject({ id: 'check-1', externalId: 'ticket-42' });
    expect(db.posCheck.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          connectionId_externalId: { connectionId: 'connection-1', externalId: 'ticket-42' },
        },
      }),
    );
    expect(db.posConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'connection-1' },
        data: expect.objectContaining({ status: 'ACTIVE', cursor: 'cursor-2' }),
      }),
    );
  });
});
