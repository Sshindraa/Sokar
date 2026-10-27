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
        callId: 'call-1',
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
        callId: null,
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
        callId: null,
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
      call_reservations: 1,
      total_reservations: 2,
      covers: 6,
      // 1 réservation rattachée à un appel sur 10 appels (la réservation en ligne n'est pas un appel)
      conversion_rate: 10,
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
        callId: true,
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
        state: { in: ['CONFIRMED', 'SEATED', 'HONORED'] },
      },
      select: {
        createdAt: true,
        partySize: true,
        estimatedRevenue: true,
        confirmedRevenue: true,
      },
    });
  });

  it('GET /dashboard/stats garde comptées les réservations installées et honorées', async () => {
    const app = await getApp();
    vi.mocked(db.call.count)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(0);
    const base = { estimatedRevenue: 100, confirmedRevenue: null, createdAt: new Date() };
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      { ...base, partySize: 2, state: 'CONFIRMED', channel: 'PHONE', source: null, callId: 'c1' },
      { ...base, partySize: 3, state: 'SEATED', channel: 'PHONE', source: null, callId: 'c2' },
      { ...base, partySize: 4, state: 'HONORED', channel: 'PHONE', source: null, callId: 'c3' },
      { ...base, partySize: 5, state: 'NO_SHOW', channel: 'PHONE', source: null, callId: 'c4' },
      { ...base, partySize: 6, state: 'EXPIRED', channel: 'WEB', source: null, callId: null },
    ] as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/stats?period=7d',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.json()).toMatchObject({ total_reservations: 3, covers: 9, conversion_rate: 75 });
  });

  it('GET /dashboard/stats ne dépasse jamais 100 % de conversion avec beaucoup de réservations en ligne', async () => {
    const app = await getApp();
    vi.mocked(db.call.count)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(0);
    const online = Array.from({ length: 40 }, () => ({
      partySize: 2,
      estimatedRevenue: 50,
      confirmedRevenue: null,
      state: 'CONFIRMED',
      createdAt: new Date(),
      channel: 'WEB',
      source: 'google',
      callId: null,
    }));
    vi.mocked(db.reservation.findMany).mockResolvedValue(
      online as unknown as Awaited<ReturnType<typeof db.reservation.findMany>>,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/stats?period=30d',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.json()).toMatchObject({
      total_reservations: 40,
      call_reservations: 0,
      conversion_rate: 0,
    });
  });

  it('GET /dashboard/empty-slots donne la bonne date à chaque jour et garde les réservations installées', async () => {
    const app = await getApp();
    vi.useFakeTimers({ toFake: ['Date'] });
    // Samedi 17 octobre 2026, 10 h à Paris : minuit local est la veille à 22 h en UTC.
    vi.setSystemTime(new Date('2026-10-17T08:00:00Z'));
    try {
      vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({
        openingHours: {
          sat: { open: '12:00', close: '23:00' },
          sun: { open: '12:00', close: '22:00' },
        },
      } as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>);
      vi.mocked(db.reservation.findMany).mockResolvedValue([]);

      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/empty-slots',
        headers: { authorization: 'Bearer test' },
      });

      const days = res.json().days as Array<{ date: string; dayName: string; isOpen: boolean }>;
      expect(days[0]).toMatchObject({ date: '2026-10-17', dayName: 'sam', isOpen: true });
      expect(days[1]).toMatchObject({ date: '2026-10-18', dayName: 'dim', isOpen: true });
      expect(days[6]).toMatchObject({ date: '2026-10-23', dayName: 'ven', isOpen: false });
      expect(db.reservation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: { in: ['CONFIRMED', 'SEATED', 'HONORED'] } }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('GET /dashboard/no-show-stats ne compte que les réservations réellement attendues', async () => {
    const app = await getApp();
    vi.mocked(db.reservation.findMany).mockResolvedValue([]);

    await app.inject({
      method: 'GET',
      url: '/dashboard/no-show-stats',
      headers: { authorization: 'Bearer test' },
    });

    expect(db.reservation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restaurantId: 'test-rest-1',
          state: { in: ['CONFIRMED', 'SEATED', 'HONORED', 'NO_SHOW'] },
        }),
      }),
    );
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
