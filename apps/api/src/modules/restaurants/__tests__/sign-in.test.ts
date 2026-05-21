import { describe, it, expect, afterAll, vi } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';

// Hoisted mock: l'auth retourne null (non authentifié)
vi.mock('../../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue(null),
    },
  },
}));

describe('Auth Guard — protection des routes REST', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('GET /restaurants/:id sans session devrait retourner 401', { timeout: 30000 }, async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: '/restaurants/rest-1',
      headers: { 'content-type': 'application/json' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('POST /restaurants sans session devrait retourner 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'POST',
      url: '/restaurants',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Test' },
    });

    expect(res.statusCode).toBe(401);
  });

  it('PATCH /restaurants/:id sans session devrait retourner 401', async () => {
    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurants/rest-1',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'Test' },
    });

    expect(res.statusCode).toBe(401);
    // Vérifie que ce n'est PAS 404 (route existe) ni 500
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(500);
  });
});
