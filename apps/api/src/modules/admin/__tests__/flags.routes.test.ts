/**
 * Tests d'intégration de la route /admin/flags.
 *
 * Verifie le contrat HTTP (status, payload) et le fail-open par defaut
 * quand CONFIGCAT_SDK_KEY est absent (cas test). L'endpoint ne doit JAMAIS
 * crasher meme si la DB renvoie null ou si le SDK ConfigCat est absent.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

const AUTH = { authorization: 'Bearer fake-token' };

describe('admin /admin/flags route', () => {
  afterAll(async () => {
    await closeApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CONFIGCAT_SDK_KEY;
  });

  it('retourne 401 sans auth', async () => {
    const app = await getApp();
    const res = await app.inject({ method: 'GET', url: '/admin/flags' });
    expect(res.statusCode).toBe(401);
  });

  it('retourne le payload par defaut quand SDK absent + DB hit', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce({ plan: 'PRO' } as unknown as Awaited<
      ReturnType<typeof db.restaurant.findUnique>
    >);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/flags',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.restaurantId).toBe('test-rest-1');
    expect(body.sdkConfigured).toBe(false);
    expect(body.voicePipeline.enabled).toBe(true); // fail-open
    expect(body.voicePipeline.flagKey).toBe('voice_pipeline_enabled');
    expect(body.plan.dbPlan).toBe('PRO');
    expect(body.plan.override).toBeNull();
    expect(body.plan.effective).toBe('PRO');
    expect(typeof body.rolloutBucket).toBe('number');
    expect(body.rolloutBucket).toBeGreaterThanOrEqual(0);
    expect(body.rolloutBucket).toBeLessThan(100);
    expect(Array.isArray(body.booleans)).toBe(true);
    // Chaque boolean flag doit avoir key + enabled
    for (const entry of body.booleans) {
      expect(typeof entry.key).toBe('string');
      expect(typeof entry.enabled).toBe('boolean');
    }
    expect(typeof body.evaluatedAt).toBe('string');
  });

  it('survit a un findUnique qui throw — plan.dbPlan = null, plan.effective = null', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockRejectedValueOnce(new Error('db down'));

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/flags',
      headers: AUTH,
    });

    // Le kill switch et les booleans doivent toujours etre exposes
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.voicePipeline.enabled).toBe(true);
    expect(body.plan.dbPlan).toBeNull();
    expect(body.plan.effective).toBeNull();
  });

  it('survit a un findUnique qui retourne null (restaurant inconnu)', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockResolvedValueOnce(null);

    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/admin/flags',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.plan.dbPlan).toBeNull();
    expect(body.plan.effective).toBeNull();
  });

  it('le rolloutBucket est deterministe pour le meme restaurantId', async () => {
    const { db } = await import('../../../shared/db/client');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'STARTER' } as unknown as Awaited<
      ReturnType<typeof db.restaurant.findUnique>
    >);

    const app = await getApp();
    const res1 = await app.inject({ method: 'GET', url: '/admin/flags', headers: AUTH });
    const res2 = await app.inject({ method: 'GET', url: '/admin/flags', headers: AUTH });

    // Note: req.restaurantId est toujours 'test-rest-1' (meme org) → meme bucket
    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json().rolloutBucket).toBe(res2.json().rolloutBucket);
  });
});
