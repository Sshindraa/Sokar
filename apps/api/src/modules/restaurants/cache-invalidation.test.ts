import { describe, it, expect, afterAll, vi } from 'vitest';
import { getApp, closeApp } from '../../test/helpers';

// Hoisted mock: l'auth retourne une session valide
vi.mock('../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'test@test.com' },
        session: { id: 'session-1' },
      }),
    },
  },
}));

describe('Cache invalidation — PATCH /restaurants/:id', () => {
  it('PATCH /restaurants/:id devrait appeler redisCache.del pour invalider le cache', async () => {
    const { db } = await import('../../shared/db/client');
    const { redisCache } = await import('../../shared/redis/client');

    // Mock DB update
    (db.restaurant.update as any).mockResolvedValue({
      id: 'rest-1',
      name: 'Chez Test Modifié',
      phoneNumber: 'pn-test',
      managerPhone: '+33600000000',
      managerEmail: 'new@test.fr',
      openingHours: {},
      plan: 'STARTER',
    });

    (redisCache.del as any).mockClear();

    const app = await getApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurants/rest-1',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer valid-token',
      },
      payload: {
        name: 'Chez Test Modifié',
        managerEmail: 'new@test.fr',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(redisCache.del).toHaveBeenCalledWith('phone:pn-test');
  });
});

afterAll(async () => {
  await closeApp();
});
