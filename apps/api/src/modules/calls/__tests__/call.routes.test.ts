import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';

describe('call.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('GET /calls', () => {
    it('retourne la liste paginée des calls du restaurant', async () => {
      const app = await getApp();
      const calls = [
        { id: 'c1', restaurantId: 'test-rest-1', createdAt: new Date() },
        { id: 'c2', restaurantId: 'test-rest-1', createdAt: new Date() },
      ];
      vi.mocked(db.call.findMany).mockResolvedValue(
        calls as unknown as Awaited<ReturnType<typeof db.call.findMany>>,
      );
      vi.mocked(db.call.count).mockResolvedValue(42);

      // restaurantId comes from the auth context (requireOrg), NOT the query
      // string — never trust a client-supplied value for tenant scoping.
      const res = await app.inject({
        method: 'GET',
        url: '/calls?limit=10&offset=5',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Date objects get serialised to ISO strings on the wire; compare fields.
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe('c1');
      expect(body.data[1].id).toBe('c2');
      expect(body.data[0].restaurantId).toBe('test-rest-1');
      expect(body.total).toBe(42);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(5);

      expect(db.call.findMany).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        skip: 5,
      });
      expect(db.call.count).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1' },
      });
    });

    it('utilise les valeurs par défaut pour limit/offset (50/0)', async () => {
      const app = await getApp();
      vi.mocked(db.call.findMany).mockResolvedValue([]);
      vi.mocked(db.call.count).mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/calls',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.limit).toBe(50);
      expect(body.offset).toBe(0);
    });

    it('rejette un limit hors bornes (max 100) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/calls?limit=500',
        headers: { authorization: 'Bearer test' },
      });

      // Zod validation in route handler → 400
      expect(res.statusCode).toBe(400);
      expect(db.call.findMany).not.toHaveBeenCalled();
    });

    it('retourne 401 sans en-tête Authorization (auth guard)', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/calls',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /calls/:id', () => {
    it('retourne le call avec son latencyTrace si trouvé dans le scope', async () => {
      const app = await getApp();
      const call = {
        id: 'c1',
        restaurantId: 'test-rest-1',
        latencyTrace: { sttMs: 120, llmMs: 340 },
      };
      vi.mocked(db.call.findUnique).mockResolvedValue(
        call as unknown as Awaited<ReturnType<typeof db.call.findUnique>>,
      );

      const res = await app.inject({
        method: 'GET',
        url: '/calls/c1',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(call);
      expect(db.call.findUnique).toHaveBeenCalledWith({
        where: { id: 'c1', restaurantId: 'test-rest-1' },
        include: { latencyTrace: true },
      });
    });

    it('retourne 404 si le call n’appartient pas au restaurant (scope guard)', async () => {
      const app = await getApp();
      // Prisma where { id, restaurantId } ne matche rien → null
      vi.mocked(db.call.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/calls/c_other_restaurant',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'Call not found' });
    });
  });

  describe('DELETE /calls/:id', () => {
    it('supprime le call scoped au restaurant (204)', async () => {
      const app = await getApp();
      vi.mocked(db.call.delete).mockResolvedValue(
        {} as unknown as Awaited<ReturnType<typeof db.call.delete>>,
      );

      const res = await app.inject({
        method: 'DELETE',
        url: '/calls/c1',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(204);
      expect(db.call.delete).toHaveBeenCalledWith({
        where: { id: 'c1', restaurantId: 'test-rest-1' },
      });
    });
  });
});
