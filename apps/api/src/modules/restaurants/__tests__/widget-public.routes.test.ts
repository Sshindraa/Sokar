/**
 * Route-level tests for the public widget endpoint.
 *
 * GET /public/widget/:slug — utilisé par l'iframe sokar.tech/widget/{slug}.
 * Doit fonctionner pour tous les restos (publiés ou pas sur Sokar Connect),
 * contrairement à /public/r/:slug qui filtre sur connectPublished.
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('GET /public/widget/:slug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('renvoie 200 + restaurant quand le slug existe (peu importe connectPublished)', async () => {
    const app = await getApp();
    const fakeRestaurant = {
      id: 'rest-uuid-123',
      name: 'Chez Sokar',
      slug: 'chez-sokar-demo',
      openingHours: { mon: { open: '12:00', close: '14:30' } },
      phoneNumber: '+33123456789',
      city: 'Lyon',
      cuisineType: ['bistro'],
      coverImageUrl: null,
      formattedAddress: '1 rue de la Paix, Lyon',
    };
    const findUnique = vi.mocked(db.restaurant.findUniqueOrThrow);
    findUnique.mockResolvedValue(
      fakeRestaurant as unknown as Awaited<ReturnType<typeof db.restaurant.findUniqueOrThrow>>,
    );

    const res = await app.inject({
      method: 'GET',
      url: '/public/widget/chez-sokar-demo',
    });

    expect(res.statusCode).toBe(200);
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: 'chez-sokar-demo' },
      select: expect.objectContaining({ id: true, name: true, openingHours: true }),
    });
    const body = res.json();
    expect(body.id).toBe('rest-uuid-123');
    expect(body.slug).toBe('chez-sokar-demo');
  });

  it('renvoie 404 quand le slug est inconnu', async () => {
    const app = await getApp();
    const findUnique = vi.mocked(db.restaurant.findUniqueOrThrow);
    findUnique.mockRejectedValue(new Error('Not found'));

    const res = await app.inject({
      method: 'GET',
      url: '/public/widget/does-not-exist',
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Restaurant not found' });
  });
});
