import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('dashboard.routes tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('GET /dashboard/stats scope appels et réservations au restaurant auth', async () => {
    const app = await getApp();
    vi.mocked(db.call.count).mockResolvedValueOnce(10).mockResolvedValueOnce(8);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        partySize: 2,
        estimatedRevenue: 70,
        confirmedRevenue: null,
        status: 'CONFIRMED',
        createdAt: new Date(),
      },
    ] as any);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/stats?period=7d&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.call.count).toHaveBeenNthCalledWith(1, {
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
      },
    });
    expect(db.reservation.findMany).toHaveBeenCalledWith({
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
      },
      select: {
        partySize: true,
        estimatedRevenue: true,
        confirmedRevenue: true,
        status: true,
        createdAt: true,
      },
    });
    expect(db.call.count).toHaveBeenNthCalledWith(2, {
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
        outcome: { not: null },
      },
    });
  });

  it('GET /dashboard/analytics ne lit jamais les données du restaurant passé en query', async () => {
    const app = await getApp();
    vi.mocked(db.call.findMany).mockResolvedValue([]);
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/analytics?period=30d&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.call.findMany).toHaveBeenCalledWith({
      where: { restaurantId: 'test-rest-1', createdAt: { gte: expect.any(Date) } },
      select: { createdAt: true },
    });
    expect(db.reservation.findMany).toHaveBeenCalledWith({
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
        status: 'CONFIRMED',
      },
      select: {
        createdAt: true,
        partySize: true,
        estimatedRevenue: true,
        confirmedRevenue: true,
      },
    });
  });

  it('GET /dashboard/recent-activity scope les deux listes au restaurant auth', async () => {
    const app = await getApp();
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);
    vi.mocked(db.call.findMany).mockResolvedValue([]);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/recent-activity?limit=5&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.reservation.findMany).toHaveBeenCalledWith({
      where: { restaurantId: 'test-rest-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    expect(db.call.findMany).toHaveBeenCalledWith({
      where: { restaurantId: 'test-rest-1' },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  });
});
