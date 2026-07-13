import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('analytics.routes tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('GET /analytics/roi utilise req.restaurantId, pas restaurantId query', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      plan: 'STARTER',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/roi?period=2026-06&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.restaurant.findUnique).toHaveBeenCalledWith({ where: { id: 'test-rest-1' } });
    expect(db.reservation.findMany).toHaveBeenCalledWith({
      where: {
        restaurantId: 'test-rest-1',
        status: 'CONFIRMED',
        createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
      },
    });
  });

  it('GET /analytics/latency filtre les traces via Call.restaurantId auth', async () => {
    const app = await getApp();
    vi.mocked(db.latencyTrace.findMany).mockResolvedValue([
      { totalE2eMs: 100 },
      { totalE2eMs: 200 },
    ] as unknown as Awaited<ReturnType<typeof db.latencyTrace.findMany>>);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/latency?period=2026-06&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.latencyTrace.findMany).toHaveBeenCalledWith({
      where: {
        call: {
          restaurantId: 'test-rest-1',
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
        },
      },
      orderBy: { totalE2eMs: 'asc' },
    });
  });
});
