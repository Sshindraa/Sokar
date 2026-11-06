import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadComputedCustomerVisits } from '../customer-lifecycle';

const mocks = vi.hoisted(() => ({
  revisionFind: vi.fn(),
  reservationFind: vi.fn(),
  mget: vi.fn(),
  pipeline: vi.fn(),
  cache: new Map<string, string>(),
}));

vi.mock('../../../shared/db/client', () => ({
  db: {
    customerVisitCacheRevision: { findMany: mocks.revisionFind },
    reservation: { findMany: mocks.reservationFind },
  },
}));
vi.mock('../../../shared/redis/client', () => ({
  redisCache: { mget: mocks.mget, pipeline: mocks.pipeline },
}));

describe('customer visit cache', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cache.clear();
    mocks.revisionFind.mockResolvedValue([{ customerId: 'c1', version: 1n }]);
    mocks.reservationFind.mockResolvedValue([]);
    mocks.mget.mockImplementation(async (...keys: string[]) =>
      keys.map((key) => mocks.cache.get(key) ?? null),
    );
    mocks.pipeline.mockImplementation(() => {
      const writes: Array<[string, string]> = [];
      return {
        set: (key: string, value: string) => writes.push([key, value]),
        exec: async () => {
          for (const [key, value] of writes) mocks.cache.set(key, value);
        },
      };
    });
  });

  it('reuses a calculation and reloads after the database revision changes', async () => {
    const reservation = {
      customerId: 'c1',
      state: 'HONORED',
      status: 'CONFIRMED',
      startsAt: new Date('2026-11-01T12:00:00Z'),
      reservedAt: now,
    };
    mocks.reservationFind.mockResolvedValue([reservation]);
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.summary.visits).toBe(1);
    await loadComputedCustomerVisits('r1', ['c1'], new Date(now.getTime() + 1000));
    expect(mocks.reservationFind).toHaveBeenCalledTimes(1);
    mocks.revisionFind.mockResolvedValue([{ customerId: 'c1', version: 2n }]);
    mocks.reservationFind.mockResolvedValue([]);
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.summary.visits).toBe(0);
    expect(mocks.reservationFind).toHaveBeenCalledTimes(2);
  });

  it('reuses the calculations for 5,000 customers with 20 reservations each', async () => {
    const ids = Array.from({ length: 5_000 }, (_, index) => `customer-${index}`);
    const date = new Date(now.getTime() - 86_400_000);
    mocks.revisionFind.mockResolvedValue([]);
    mocks.reservationFind.mockResolvedValue(
      ids.flatMap((customerId) =>
        Array.from({ length: 20 }, () => ({
          customerId,
          state: 'HONORED',
          status: 'CONFIRMED',
          startsAt: date,
          reservedAt: date,
        })),
      ),
    );
    const first = await loadComputedCustomerVisits('r1', ids, now);
    const second = await loadComputedCustomerVisits('r1', ids, new Date(now.getTime() + 1000));
    expect(first.size).toBe(5_000);
    expect(second.get('customer-4999')?.summary.visits).toBe(20);
    expect(mocks.reservationFind).toHaveBeenCalledTimes(1);
  });

  it('recalculates when a future reservation becomes a past visit', async () => {
    mocks.reservationFind.mockResolvedValue([
      {
        customerId: 'c1',
        state: 'CONFIRMED',
        status: 'CONFIRMED',
        startsAt: new Date(now.getTime() + 1000),
        reservedAt: now,
      },
    ]);
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.summary.visits).toBe(0);
    expect(
      (await loadComputedCustomerVisits('r1', ['c1'], new Date(now.getTime() + 1001))).get('c1')
        ?.summary.visits,
    ).toBe(1);
  });

  it('recalculates when a visit crosses the 90-day threshold', async () => {
    const day = 86_400_000;
    mocks.reservationFind.mockResolvedValue(
      [10, 20, 90].map((days) => ({
        customerId: 'c1',
        state: 'HONORED',
        status: 'CONFIRMED',
        startsAt: new Date(now.getTime() - days * day),
        reservedAt: now,
      })),
    );
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.lifecycle.status).toBe(
      'regular',
    );
    expect(
      (await loadComputedCustomerVisits('r1', ['c1'], new Date(now.getTime() + 1))).get('c1')
        ?.lifecycle.status,
    ).toBe('active');
    expect(mocks.reservationFind).toHaveBeenCalledTimes(2);
  });

  it('updates the lifecycle when the elapsed-day threshold changes', async () => {
    const day = 86_400_000;
    mocks.reservationFind.mockResolvedValue(
      [46, 53, 60].map((days) => ({
        customerId: 'c1',
        state: 'HONORED',
        status: 'CONFIRMED',
        startsAt: new Date(now.getTime() - days * day + 1000),
        reservedAt: now,
      })),
    );
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.lifecycle.status).toBe(
      'regular',
    );
    expect(
      (await loadComputedCustomerVisits('r1', ['c1'], new Date(now.getTime() + 1000))).get('c1')
        ?.lifecycle.status,
    ).toBe('at_risk');
  });

  it('reads the database when Redis is unavailable', async () => {
    mocks.mget.mockRejectedValue(new Error('redis unavailable'));
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.summary.visits).toBe(0);
    expect(mocks.reservationFind).toHaveBeenCalledTimes(1);
  });

  it('reads the database when Redis does not respond', async () => {
    mocks.mget.mockReturnValue(new Promise(() => {}));
    expect((await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')?.summary.visits).toBe(0);
    expect(mocks.reservationFind).toHaveBeenCalledTimes(1);
  });

  it('updates no-show and annual visit counts at the 365-day boundary', async () => {
    const startsAt = new Date(now.getTime() - 365 * 86_400_000);
    mocks.reservationFind.mockResolvedValue([
      { customerId: 'c1', state: 'HONORED', status: 'CONFIRMED', startsAt, reservedAt: startsAt },
      { customerId: 'c1', state: 'NO_SHOW', status: 'NO_SHOW', startsAt, reservedAt: startsAt },
    ]);
    const before = (await loadComputedCustomerVisits('r1', ['c1'], now)).get('c1')!.summary;
    const after = (await loadComputedCustomerVisits('r1', ['c1'], new Date(now.getTime() + 1))).get(
      'c1',
    )!.summary;
    expect([before.visits365d, before.noShows365d]).toEqual([1, 1]);
    expect([after.visits365d, after.noShows365d]).toEqual([0, 0]);
  });
});
