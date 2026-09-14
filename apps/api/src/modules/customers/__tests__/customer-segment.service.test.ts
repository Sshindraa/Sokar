import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import {
  compileCustomerSegmentWhere,
  createCustomerSegment,
  ensureSystemCustomerSegments,
  parseCustomerSegmentDefinition,
  previewCustomerSegment,
  SYSTEM_CUSTOMER_SEGMENTS,
} from '../customer-segment.service';

vi.mock('../../../shared/db/client', () => ({
  db: {
    customer: { count: vi.fn(), findMany: vi.fn() },
    customerSegment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('customer segment compiler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('compiles bounded metric, relative date, tag and preference conditions', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const where = compileCustomerSegmentWhere(
      {
        version: 1,
        operator: 'AND',
        conditions: [
          { field: 'honored365d', op: 'GTE', value: 2 },
          { field: 'lastHonoredAt', op: 'BEFORE_DAYS_AGO', value: 60 },
          {
            operator: 'OR',
            conditions: [
              { field: 'tag', op: 'EXISTS', value: 'vip-lunch' },
              { field: 'preference', op: 'EXISTS', value: 'preferred_language' },
            ],
          },
        ],
      },
      now,
    );

    expect(where).toEqual({
      AND: [
        { metricSnapshot: { is: { honored365d: { gte: 2 } } } },
        {
          metricSnapshot: {
            is: { lastHonoredAt: { lt: new Date('2026-07-15T12:00:00.000Z') } },
          },
        },
        {
          OR: [
            { tagAssignments: { some: { tag: { key: 'vip-lunch' } } } },
            { preferences: { some: { key: 'preferred_language' } } },
          ],
        },
      ],
    });
  });

  it('rejects unknown fields, incompatible operators and more than 20 conditions', () => {
    expect(() =>
      parseCustomerSegmentDefinition({
        version: 1,
        operator: 'AND',
        conditions: [{ field: 'notes', op: 'EQ', value: 'secret' }],
      }),
    ).toThrow();
    expect(() =>
      parseCustomerSegmentDefinition({
        version: 1,
        operator: 'AND',
        conditions: [{ field: 'isVip', op: 'GTE', value: 1 }],
      }),
    ).toThrow('isVip accepts only EQ');
    expect(() =>
      parseCustomerSegmentDefinition({
        version: 1,
        operator: 'AND',
        conditions: Array.from({ length: 21 }, () => ({
          field: 'isVip',
          op: 'EQ',
          value: true,
        })),
      }),
    ).toThrow('more than 20');
  });

  it('previews with tenant and archive filters and creates a hashed actor segment', async () => {
    vi.mocked(db.customer.count).mockResolvedValue(7);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      { id: 'customer-1', name: 'Alice', isVip: true, metricSnapshot: null },
    ] as never);
    vi.mocked(db.customerSegment.create).mockResolvedValue({
      id: 'segment-1',
      name: 'VIP',
      definition: {},
    } as never);
    const definition = {
      version: 1,
      operator: 'AND' as const,
      conditions: [{ field: 'isVip' as const, op: 'EQ' as const, value: true }],
    };

    await expect(
      previewCustomerSegment({ restaurantId: 'restaurant-1', definition }),
    ).resolves.toMatchObject({ count: 7, sample: [{ id: 'customer-1' }] });
    expect(db.customer.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ restaurantId: 'restaurant-1', archivedAt: null }),
    });

    await expect(
      createCustomerSegment({
        restaurantId: 'restaurant-1',
        name: 'VIP',
        definition,
        createdBy: 'user-1',
      }),
    ).resolves.toMatchObject({ id: 'segment-1' });
    expect(db.customerSegment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        restaurantId: 'restaurant-1',
        name: 'VIP',
        lastCount: 7,
        createdByHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
  });

  it('seeds the eight system audiences idempotently for a tenant', async () => {
    vi.mocked(db.customerSegment.findFirst).mockResolvedValue(null);
    vi.mocked(db.customerSegment.create).mockResolvedValue({ id: 'system-segment' } as never);
    vi.mocked(db.customer.count).mockResolvedValue(0);
    vi.mocked(db.customer.findMany).mockResolvedValue([]);

    await ensureSystemCustomerSegments({ restaurantId: 'restaurant-1' });

    expect(SYSTEM_CUSTOMER_SEGMENTS).toHaveLength(8);
    expect(db.customerSegment.findFirst).toHaveBeenCalledTimes(8);
    expect(db.customerSegment.create).toHaveBeenCalledTimes(8);
    expect(db.customerSegment.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          restaurantId: 'restaurant-1',
          systemKey: 'first_visit_30d',
          isSystem: true,
        }),
      }),
    );
  });
});
