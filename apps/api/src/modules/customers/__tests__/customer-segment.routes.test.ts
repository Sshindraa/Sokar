import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('customer segment routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
  });

  afterAll(closeApp);

  const definition = {
    version: 1,
    operator: 'AND',
    conditions: [{ field: 'honored365d', op: 'GTE', value: 2 }],
  };

  it('ferme les segments en production lorsque le flag marketing reste fermé', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFlag = process.env.MARKETING_FEATURES_ENABLED;
    process.env.NODE_ENV = 'production';
    delete process.env.MARKETING_FEATURES_ENABLED;
    try {
      const app = await getApp();
      const response = await app.inject({
        method: 'POST',
        url: '/marketing/segments/preview',
        headers: { authorization: 'Bearer test' },
        payload: { definition },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: 'MARKETING_FEATURES_DISABLED' });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousFlag === undefined) delete process.env.MARKETING_FEATURES_ENABLED;
      else process.env.MARKETING_FEATURES_ENABLED = previousFlag;
    }
  });

  it('previews a bounded segment with a tenant filter', async () => {
    const app = await getApp();
    vi.mocked(db.customer.count).mockResolvedValue(4);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      { id: 'customer-1', name: 'Alice', isVip: true, metricSnapshot: null },
    ] as never);

    const response = await app.inject({
      method: 'POST',
      url: '/marketing/segments/preview',
      headers: { authorization: 'Bearer test' },
      payload: { definition },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      count: 4,
      sample: [{ id: 'customer-1', name: 'Alice', isVip: true, metricSnapshot: null }],
    });
    expect(db.customer.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ restaurantId: 'test-rest-1', archivedAt: null }),
    });
  });

  it('creates and lists a versioned segment for Pro', async () => {
    const app = await getApp();
    vi.mocked(db.customer.count).mockResolvedValue(3);
    vi.mocked(db.customer.findMany).mockResolvedValue([]);
    vi.mocked(db.customerSegment.create).mockResolvedValue({
      id: 'segment-1',
      restaurantId: 'test-rest-1',
      name: 'Habitués',
      definition,
      definitionVersion: 1,
    } as never);
    vi.mocked(db.customerSegment.findMany).mockResolvedValue([
      { id: 'segment-1', name: 'Habitués', definitionVersion: 1 },
    ] as never);

    const created = await app.inject({
      method: 'POST',
      url: '/marketing/segments',
      headers: { authorization: 'Bearer test' },
      payload: { name: 'Habitués', definition },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ data: expect.objectContaining({ id: 'segment-1' }) });

    const listed = await app.inject({
      method: 'GET',
      url: '/marketing/segments',
      headers: { authorization: 'Bearer test' },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({
      data: [{ id: 'segment-1', name: 'Habitués', definitionVersion: 1 }],
    });
  });

  it('refuses segment routes on Essential before reading customer data', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'ESSENTIAL' } as never);

    const response = await app.inject({
      method: 'POST',
      url: '/marketing/segments/preview',
      headers: { authorization: 'Bearer test' },
      payload: { definition },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: 'CAPABILITY_NOT_INCLUDED',
      capability: 'marketing.segments',
    });
    expect(db.customer.count).not.toHaveBeenCalled();
  });
});
