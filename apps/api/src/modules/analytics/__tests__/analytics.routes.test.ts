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
        state: 'CONFIRMED',
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
