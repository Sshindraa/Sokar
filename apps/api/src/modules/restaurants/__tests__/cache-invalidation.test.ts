import { describe, it, expect, afterAll, vi } from 'vitest';
import { closeApp } from '../../../test/helpers';

// Hoist these mocks BEFORE importing helpers.ts to ensure they take effect
vi.mock('../../../lib/auth', () => ({
  auth: {
    api: {
      getSession: vi.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'test@test.com' },
        session: { id: 'session-1' },
      }),
    },
  },
}));

vi.mock('../../../shared/db/client', () => ({
  db: {
    restaurant: {
      create: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    agentPersonality: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock('../../../shared/redis/client', () => ({
  redisCache: {
    del: vi.fn(),
  },
}));

describe('Cache invalidation — PATCH /restaurants/:id', () => {
  it('PATCH /restaurants/:id devrait appeler redisCache.del pour invalider le cache', async () => {
    const { db } = await import('../../../shared/db/client');
    const { redisCache } = await import('../../../shared/redis/client');
    const { getApp } = await import('../../../test/helpers');

    const mockRestaurant = {
      id: 'rest-1',
      name: 'Chez Test Modifié',
      phoneNumber: 'pn-test',
      managerPhone: '+33600000000',
      managerEmail: 'new@test.fr',
      openingHours: {},
      plan: 'STARTER' as const,
    };

    (db.restaurant.update as any).mockResolvedValue(mockRestaurant);
    (db.restaurant.findUniqueOrThrow as any).mockResolvedValue(mockRestaurant);
    (db.agentPersonality.findUnique as any).mockResolvedValue(null);
    (db.agentPersonality.upsert as any).mockResolvedValue({} as any);

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
