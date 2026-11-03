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
        state: { in: ['CONFIRMED', 'SEATED', 'HONORED'] },
        createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
      },
    });
  });

  it('GET /analytics/latency filtre les traces via Call.restaurantId auth', async () => {
    const app = await getApp();
    vi.mocked(db.$queryRaw).mockResolvedValue([{ total: 3, p50: 200, p95: 200 }]);
    vi.mocked(db.latencyTrace.findMany).mockResolvedValue([
      { totalE2eMs: null },
      { totalE2eMs: 200 },
      { totalE2eMs: 100 },
    ] as unknown as Awaited<ReturnType<typeof db.latencyTrace.findMany>>);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/latency?period=2026-06&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      totalCalls: 3,
      p50: 200,
      p95: 200,
      traces: [{ totalE2eMs: 100 }, { totalE2eMs: 200 }, { totalE2eMs: null }],
    });
    expect(vi.mocked(db.$queryRaw).mock.calls[0]).toEqual(
      expect.arrayContaining(['test-rest-1', expect.any(Date), expect.any(Date)]),
    );
    expect(db.latencyTrace.findMany).toHaveBeenCalledWith({
      where: {
        call: {
          restaurantId: 'test-rest-1',
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
        },
      },
      orderBy: { totalE2eMs: { sort: 'desc', nulls: 'first' } },
      take: 50,
    });
  });

  it('ne retourne pas de traces si aucune latence ne peut être calculée', async () => {
    const app = await getApp();
    vi.mocked(db.$queryRaw).mockResolvedValue([{ total: 1, p50: null, p95: null }]);
    vi.mocked(db.latencyTrace.findMany).mockResolvedValue([
      { totalE2eMs: null },
    ] as unknown as Awaited<ReturnType<typeof db.latencyTrace.findMany>>);
    const res = await app.inject({
      method: 'GET',
      url: '/analytics/latency?period=2026-06',
      headers: { authorization: 'Bearer test' },
    });
    expect(res.json()).toEqual({
      period: '2026-06',
      totalCalls: 0,
      p50: null,
      p95: null,
      traces: [],
    });
  });

  it.each(['/analytics/roi', '/analytics/latency', '/analytics/voice'])(
    '%s refuse les mois invalides',
    async (path) => {
      const app = await getApp();
      for (const period of ['2026-00', '2026-13']) {
        const res = await app.inject({
          method: 'GET',
          url: `${path}?period=${period}`,
          headers: { authorization: 'Bearer test' },
        });
        expect(res.statusCode).toBe(400);
      }
    },
  );

  it('GET /analytics/voice expose les indicateurs du pilote avec le scope restaurant', async () => {
    const app = await getApp();
    vi.mocked(db.call.count)
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(4);
    vi.mocked(db.voiceCallTelemetry.aggregate).mockResolvedValue({
      _count: { _all: 1 },
      _sum: {
        turnCount: 4,
        llmTurnCount: 2,
        deterministicTurnCount: 1,
        fallbackTurnCount: 1,
        availabilitySearchCount: 2,
        availabilityFailureCount: 1,
        loopCount: 1,
      },
    } as unknown as Awaited<ReturnType<typeof db.voiceCallTelemetry.aggregate>>);
    vi.mocked(db.voiceCallTelemetry.count).mockResolvedValue(1);

    const res = await app.inject({
      method: 'GET',
      url: '/analytics/voice?period=2026-06&restaurantId=other-rest',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      period: '2026-06',
      calls: {
        total: 8,
        withTelemetry: 1,
        unfinalized: 2,
        reservationsConfirmed: 3,
        reservationIntentAbandoned: 4,
      },
      voice: {
        turns: 4,
        llmTurns: 2,
        deterministicTurns: 1,
        fallbackTurns: 1,
        availabilitySearches: 2,
        availabilityFailures: 1,
        loopsDetected: 1,
        reservationIntentAbandoned: 1,
      },
    });
    expect(db.voiceCallTelemetry.aggregate).toHaveBeenCalledWith({
      where: {
        call: {
          restaurantId: 'test-rest-1',
          createdAt: { gte: expect.any(Date), lte: expect.any(Date) },
        },
      },
      _count: { _all: true },
      _sum: {
        turnCount: true,
        llmTurnCount: true,
        deterministicTurnCount: true,
        fallbackTurnCount: true,
        availabilitySearchCount: true,
        availabilityFailureCount: true,
        loopCount: true,
      },
    });
  });
});
