import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

const AUTH = { authorization: 'Bearer fake-token' };

describe('usage routes', () => {
  afterAll(closeApp);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'STARTER' } as never);
    vi.mocked(db.usageEvent.groupBy).mockResolvedValue([]);
    vi.mocked(db.usageMonthlyRollup.findMany).mockResolvedValue([]);
  });

  it('requires authentication', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/usage/current' });
    expect(response.statusCode).toBe(401);
  });

  it('returns quantities and plan limits without cost data', async () => {
    vi.mocked(db.usageEvent.groupBy).mockResolvedValue([
      { category: 'TELEPHONY_SECONDS', _sum: { quantity: new Prisma.Decimal(125) } },
    ] as never);

    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/usage/current', headers: AUTH });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.usage).toEqual([{ category: 'TELEPHONY_SECONDS', quantity: '125.000000' }]);
    expect(body.included).toEqual({ voiceMinutes: null, smsSegments: null });
    expect(body.limitsEnforced).toEqual({ voiceMinutes: false, smsSegments: false });
    expect(JSON.stringify(body)).not.toMatch(/cost|margin|provider/i);
  });

  it('returns bounded monthly history without estimated costs', async () => {
    vi.mocked(db.usageMonthlyRollup.findMany).mockResolvedValue([
      {
        restaurantId: 'test-rest-1',
        monthKey: '2026-08',
        category: 'SMS_SEGMENTS',
        quantity: new Prisma.Decimal(4),
        estimatedCost: new Prisma.Decimal('0.32'),
        updatedAt: new Date(),
      },
    ]);

    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/usage/history?from=2026-08&to=2026-09',
      headers: AUTH,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      from: '2026-08',
      to: '2026-09',
      months: [
        { month: '2026-08', categories: [{ category: 'SMS_SEGMENTS', quantity: '4.000000' }] },
      ],
    });
  });

  it('rejects malformed or reversed periods', async () => {
    const app = await getApp();
    const malformed = await app.inject({
      method: 'GET',
      url: '/usage/history?from=2026-13&to=2026-09',
      headers: AUTH,
    });
    expect(malformed.statusCode).toBe(400);

    const reversed = await app.inject({
      method: 'GET',
      url: '/usage/history?from=2026-10&to=2026-09',
      headers: AUTH,
    });
    expect(reversed.statusCode).toBe(400);

    const tooWide = await app.inject({
      method: 'GET',
      url: '/usage/history?from=2024-01&to=2026-09',
      headers: AUTH,
    });
    expect(tooWide.statusCode).toBe(400);
  });
});
