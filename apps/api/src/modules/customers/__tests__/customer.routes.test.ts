import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { Prisma } from '@prisma/client';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { redisCache } from '../../../shared/redis/client';

describe('customer.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  describe('GET /customers', () => {
    it('liste les clients du restaurant, triés par visitCount desc', async () => {
      const app = await getApp();
      const customers = [
        { id: 'c1', restaurantId: 'test-rest-1', name: 'Alice', visitCount: 10 },
        { id: 'c2', restaurantId: 'test-rest-1', name: 'Bob', visitCount: 5 },
      ];
      vi.mocked(db.customer.findMany).mockResolvedValue(customers as any);
      vi.mocked(db.customer.count).mockResolvedValue(2);

      const res = await app.inject({
        method: 'GET',
        url: '/customers?limit=10&offset=0',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customer.findMany).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1' },
        orderBy: { visitCount: 'desc' },
        take: 10,
        skip: 0,
      });
      expect(db.customer.count).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1' },
      });
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.data).toHaveLength(2);
    });

    it('filtre par phone si fourni (recherche)', async () => {
      const app = await getApp();
      vi.mocked(db.customer.findMany).mockResolvedValue([]);
      vi.mocked(db.customer.count).mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/customers?phone=%2B33612345678',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customer.findMany).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1', phone: '+33612345678' },
        orderBy: { visitCount: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('rejette un phone invalide (regex E.164) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/customers?phone=pas-un-numero',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('rejette limit > 100 avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/customers?limit=500',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(400);
    });

    it('retourne 401 sans Authorization', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'GET',
        url: '/customers',
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /customers (upsert)', () => {
    it("crée un client (201) avec le restaurantId issu de l'auth, pas du payload", async () => {
      const app = await getApp();
      const created = {
        id: 'c1',
        restaurantId: 'test-rest-1',
        phone: '+33612345678',
        name: 'Alice',
      };
      vi.mocked(db.customer.upsert).mockResolvedValue(created as any);

      const res = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
        payload: {
          restaurantId: 'other-rest-should-be-ignored',
          phone: '+33612345678',
          name: 'Alice',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(created);
      const upsertArgs = vi.mocked(db.customer.upsert).mock.calls[0][0] as any;
      expect(upsertArgs.where.restaurantId_phone.restaurantId).toBe('test-rest-1');
      expect(upsertArgs.where.restaurantId_phone.restaurantId).not.toBe(
        'other-rest-should-be-ignored',
      );
      expect(upsertArgs.create.restaurantId).toBe('test-rest-1');
      expect(upsertArgs.create.name).toBe('Alice');
      expect(upsertArgs.update.name).toBe('Alice');
    });

    it('retourne 409 (Conflict) si Prisma soulève P2002', async () => {
      // Le code wrap P2002 en 409 — vérifions le mapping.
      const app = await getApp();
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '6.0.0',
      });
      vi.mocked(db.customer.upsert).mockRejectedValue(prismaError);

      const res = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
        payload: {
          restaurantId: 'test-rest-1',
          phone: '+33612345678',
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'Customer already exists' });
    });

    it('propage les autres erreurs Prisma en 500 (pas wrap)', async () => {
      const app = await getApp();
      vi.mocked(db.customer.upsert).mockRejectedValue(
        Object.assign(new Error('Connection lost'), { code: 'P1001' }),
      );

      const res = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
        payload: { restaurantId: 'test-rest-1', phone: '+33612345678' },
      });

      // 500 (ou selon le error handler global) — l'important est
      // qu'on n'a PAS map P1001 vers 409.
      expect(res.statusCode).toBeGreaterThanOrEqual(500);
    });

    it('rejette un phone hors regex avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
        payload: { restaurantId: 'test-rest-1', phone: 'abc' },
      });

      expect(res.statusCode).toBe(400);
      expect(db.customer.upsert).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /customers/:id', () => {
    it('met à jour + invalide le cache Redis (key customer:{rest}:{phone})', async () => {
      const app = await getApp();
      const updated = {
        id: 'c1',
        restaurantId: 'test-rest-1',
        phone: '+33612345678',
        name: 'Alice Updated',
      };
      vi.mocked(db.customer.update).mockResolvedValue(updated as any);
      vi.mocked(redisCache.del).mockResolvedValue(1);

      const res = await app.inject({
        method: 'PATCH',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'Alice Updated' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: '00000000-0000-0000-0000-000000000001', restaurantId: 'test-rest-1' },
        data: { name: 'Alice Updated' },
      });
      expect(redisCache.del).toHaveBeenCalledWith(expect.stringContaining('customer:test-rest-1:'));
    });

    it('rejette un id non-UUID avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'PATCH',
        url: '/customers/not-a-uuid',
        headers: { authorization: 'Bearer test' },
        payload: { name: 'X' },
      });

      expect(res.statusCode).toBe(400);
      expect(db.customer.update).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /customers/:id', () => {
    it('supprime scoped au restaurant et retourne 204', async () => {
      const app = await getApp();
      vi.mocked(db.customer.delete).mockResolvedValue({} as any);

      const res = await app.inject({
        method: 'DELETE',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(204);
      expect(db.customer.delete).toHaveBeenCalledWith({
        where: { id: '00000000-0000-0000-0000-000000000001', restaurantId: 'test-rest-1' },
      });
    });
  });

  describe('POST /customers/:id/vip (toggle VIP)', () => {
    it('passe isVip à true et invalide le cache', async () => {
      const app = await getApp();
      const updated = {
        id: 'c1',
        restaurantId: 'test-rest-1',
        phone: '+33612345678',
        isVip: true,
      };
      vi.mocked(db.customer.update).mockResolvedValue(updated as any);
      vi.mocked(redisCache.del).mockResolvedValue(1);

      const res = await app.inject({
        method: 'POST',
        url: '/customers/00000000-0000-0000-0000-000000000001/vip',
        headers: { authorization: 'Bearer test' },
        payload: { isVip: true },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: '00000000-0000-0000-0000-000000000001', restaurantId: 'test-rest-1' },
        data: { isVip: true },
      });
      expect(redisCache.del).toHaveBeenCalledWith(expect.stringContaining('customer:test-rest-1:'));
      expect(res.json().isVip).toBe(true);
    });

    it('rejette isVip manquant (Zod required) avec 400', async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'POST',
        url: '/customers/00000000-0000-0000-0000-000000000001/vip',
        headers: { authorization: 'Bearer test' },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
