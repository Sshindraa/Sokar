import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCityPage, fetchPublicRestaurant, fetchPublicRestaurants } from '../api-client';

function mockFetch(status: number, body: unknown = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe('api-client Connect : limitation ≠ introuvable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('un vrai 404 donne null (page introuvable)', async () => {
    mockFetch(404);
    await expect(fetchPublicRestaurant('chez-sokar')).resolves.toBeNull();
    await expect(fetchCityPage('paris')).resolves.toBeNull();
  });

  it('un 429 lève une erreur au lieu de faire passer le restaurant pour introuvable', async () => {
    mockFetch(429);
    await expect(fetchPublicRestaurant('chez-sokar')).rejects.toThrow('429');
    await expect(fetchCityPage('paris')).rejects.toThrow('429');
  });

  it('une panne ne vide pas le catalogue', async () => {
    mockFetch(503);
    await expect(fetchPublicRestaurants()).rejects.toThrow('503');
  });

  it('au build, sans API, le catalogue part vide au lieu de casser la compilation', async () => {
    vi.stubEnv('NEXT_PHASE', 'phase-production-build');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(fetchPublicRestaurants()).resolves.toEqual({
      restaurants: [],
      total: 0,
      page: 1,
      limit: 12,
    });
    vi.unstubAllEnvs();
  });
});
