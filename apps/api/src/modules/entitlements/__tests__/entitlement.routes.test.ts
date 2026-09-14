import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';

const AUTH = { authorization: 'Bearer fake-token' };

describe('GET /entitlements', () => {
  afterAll(closeApp);

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIGCAT_SDK_KEY;
  });

  it('requires an authenticated restaurant', async () => {
    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/entitlements' });
    expect(response.statusCode).toBe(401);
  });

  it('normalizes the legacy STARTER plan to Essential', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce({ plan: 'STARTER' } as never);

    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/entitlements', headers: AUTH });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      restaurantId: 'test-rest-1',
      id: 'essential',
      sourcePlan: 'STARTER',
      supportLevel: 'standard',
      capabilities: {
        'voice.inbound': true,
        'reactivation.manage': false,
        'customers.advanced': false,
        'marketing.segments': false,
        'account.multiSite': false,
      },
      limits: { sites: 1 },
    });
  });

  it('exposes Pro capabilities without internal cost data', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce({ plan: 'PRO' } as never);

    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/entitlements', headers: AUTH });
    const body = response.json();

    expect(response.statusCode).toBe(200);
    expect(body.id).toBe('pro');
    expect(body.capabilities['customers.vipRecognition']).toBe(true);
    expect(body.capabilities['customers.advanced']).toBe(true);
    expect(body.capabilities['reactivation.manage']).toBe(true);
    expect(body.capabilities['marketing.segments']).toBe(true);
    expect(body.capabilities['account.multiSite']).toBe(false);
    expect(JSON.stringify(body)).not.toContain('cost');
    expect(Date.parse(body.evaluatedAt)).not.toBeNaN();
  });

  it('returns 404 when the restaurant does not exist', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce(null);

    const app = await getApp();
    const response = await app.inject({ method: 'GET', url: '/entitlements', headers: AUTH });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'RESTAURANT_NOT_FOUND' });
  });
});
