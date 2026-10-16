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
    // 1: totalCalls (10), 2: answeredCalls (8), 3: recoverableCalls (3)
    vi.mocked(db.call.count)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(3);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        partySize: 2,
        estimatedRevenue: 70,
        confirmedRevenue: null,
        status: 'CONFIRMED',
        state: 'CONFIRMED',
        createdAt: new Date(),
        channel: 'PHONE',
        source: null,
      },
      {
        partySize: 4,
        estimatedRevenue: 180,
        confirmedRevenue: 220,
        status: 'CONFIRMED',
        state: 'CONFIRMED',
        createdAt: new Date(),
        channel: 'WEB',
        source: 'chatgpt',
      },
      {
        partySize: 6,
        estimatedRevenue: 300,
        confirmedRevenue: null,
        status: 'CANCELLED',
        state: 'CANCELLED',
        createdAt: new Date(),
        channel: 'WEB',
        source: 'google',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/stats?period=7d&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      period: '7d',
      total_calls: 10,
      total_reservations: 2,
      covers: 6,
      conversion_rate: 20,
      answered_rate: 80,
      estimated_revenue: 290,
      // 2 confirmed reservations × 290/2 = 145 avg × 3 recoverable = 435
      revenue_recovered: 435,
      by_channel: [
        { channel: 'phone', reservations: 1, covers: 2 },
        { channel: 'website', reservations: 0, covers: 0 },
        { channel: 'google', reservations: 0, covers: 0 },
        { channel: 'ai', reservations: 1, covers: 4 },
        { channel: 'team', reservations: 0, covers: 0 },
      ],
    });
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
        state: true,
        createdAt: true,
        channel: true,
        source: true,
      },
    });
    expect(db.call.count).toHaveBeenNthCalledWith(2, {
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
        outcome: { not: null },
      },
    });
    expect(db.call.count).toHaveBeenNthCalledWith(3, {
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
        outcome: { in: ['NO_ACTION', 'HANDOFF', 'ERROR'] },
      },
    });
  });

  it('GET /dashboard/analytics ne lit jamais les données du restaurant passé en query', async () => {
    const app = await getApp();
    vi.mocked(db.call.findMany).mockResolvedValue([
      { createdAt: new Date() },
      { createdAt: new Date() },
    ] as unknown as Awaited<ReturnType<typeof db.call.findMany>>);
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      {
        createdAt: new Date(),
        partySize: 3,
        estimatedRevenue: 120,
        confirmedRevenue: null,
        state: 'CONFIRMED',
      },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/analytics?period=today&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.period).toBe('today');
    expect(body.data).toHaveLength(24);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ calls: 2, reservations: 1, covers: 3, revenue: 120 }),
      ]),
    );
    expect(db.call.findMany).toHaveBeenCalledWith({
      where: { restaurantId: 'test-rest-1', createdAt: { gte: expect.any(Date) } },
      select: { createdAt: true },
    });
    expect(db.reservation.findMany).toHaveBeenCalledWith({
      where: {
        restaurantId: 'test-rest-1',
        createdAt: { gte: expect.any(Date) },
        state: 'CONFIRMED',
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
