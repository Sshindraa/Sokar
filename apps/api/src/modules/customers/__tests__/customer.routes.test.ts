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
    it('liste les clients du restaurant, triés par dernier contact', async () => {
      const app = await getApp();
      const customers = [
        { id: 'c1', restaurantId: 'test-rest-1', name: 'Alice' },
        { id: 'c2', restaurantId: 'test-rest-1', name: 'Bob' },
      ];
      vi.mocked(db.customer.findMany).mockResolvedValue(
        customers as unknown as Awaited<ReturnType<typeof db.customer.findMany>>,
      );
      vi.mocked(db.customer.count).mockResolvedValue(2);

      const res = await app.inject({
        method: 'GET',
        url: '/customers?limit=10&offset=0',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customer.findMany).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1', archivedAt: null, mergedIntoId: null },
        orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: 10,
        skip: 0,
      });
      expect(db.customer.count).toHaveBeenCalledWith({
        where: { restaurantId: 'test-rest-1', archivedAt: null, mergedIntoId: null },
      });
      const body = res.json();
      expect(body.total).toBe(2);
      expect(body.data).toHaveLength(2);
    });

    it('ajoute le statut de cycle de vie calculé sur les vraies visites, en une seule requête', async () => {
      const app = await getApp();
      vi.mocked(db.customer.findMany).mockResolvedValue([
        { id: 'c1', restaurantId: 'test-rest-1', name: 'Alice' },
        { id: 'c2', restaurantId: 'test-rest-1', name: 'Bob' },
      ] as never);
      vi.mocked(db.customer.count).mockResolvedValue(2);
      const recent = (days: number) => new Date(Date.now() - days * 86_400_000);
      vi.mocked(db.reservation.findMany).mockResolvedValue([
        {
          customerId: 'c2',
          state: 'HONORED',
          status: 'CONFIRMED',
          startsAt: recent(3),
          reservedAt: recent(3),
        },
        {
          customerId: 'c2',
          state: 'HONORED',
          status: 'CONFIRMED',
          startsAt: recent(20),
          reservedAt: recent(20),
        },
        {
          customerId: 'c2',
          state: 'SEATED',
          status: 'SEATED',
          startsAt: recent(40),
          reservedAt: recent(40),
        },
      ] as never);

      const res = await app.inject({
        method: 'GET',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.reservation.findMany).toHaveBeenCalledTimes(1);
      expect(vi.mocked(db.reservation.findMany).mock.calls[0][0]?.where).toMatchObject({
        restaurantId: 'test-rest-1',
        customerId: { in: ['c1', 'c2'] },
      });
      const [alice, bob] = res.json().data;
      expect(alice.lifecycle.status).toBe('new');
      expect(bob.lifecycle).toEqual({ status: 'regular', reason: '3 visites en 90 jours' });
      expect(alice).not.toHaveProperty('visitCount');
    });

    describe('GET /customers/service-cards', () => {
      it('rejette une liste vide', async () => {
        const app = await getApp();
        const res = await app.inject({
          method: 'GET',
          url: '/customers/service-cards?reservationIds=',
          headers: { authorization: 'Bearer test' },
        });
        expect(res.statusCode).toBe(400);
      });

      it('renvoie les cartes de toute la liste, limitées au restaurant', async () => {
        const app = await getApp();
        vi.mocked(db.reservation.findMany).mockResolvedValueOnce([] as never);
        vi.mocked(db.restaurant.findUnique).mockResolvedValue({
          timezone: 'Europe/Paris',
        } as never);
        const res = await app.inject({
          method: 'GET',
          url: '/customers/service-cards?reservationIds=r1,r2',
          headers: { authorization: 'Bearer test' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ data: [] });
        expect(vi.mocked(db.reservation.findMany).mock.calls[0][0]?.where).toEqual({
          restaurantId: 'test-rest-1',
          id: { in: ['r1', 'r2'] },
        });
      });
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
        where: {
          restaurantId: 'test-rest-1',
          archivedAt: null,
          mergedIntoId: null,
          phone: '+33612345678',
        },
        orderBy: [{ lastSeenAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: 50,
        skip: 0,
      });
    });

    it('exclut les clients effacés (RGPD) et les profils déjà fusionnés de la liste et du total', async () => {
      const app = await getApp();
      vi.mocked(db.customer.findMany).mockResolvedValue([]);
      vi.mocked(db.customer.count).mockResolvedValue(0);

      await app.inject({
        method: 'GET',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
      });

      const expected = expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null, mergedIntoId: null }),
      });
      expect(db.customer.findMany).toHaveBeenCalledWith(expected);
      expect(db.customer.count).toHaveBeenCalledWith(expected);
    });

    it('retrouve un client avec un numéro saisi à la française, entier ou en partie', async () => {
      const app = await getApp();
      vi.mocked(db.customer.findMany).mockResolvedValue([]);
      vi.mocked(db.customer.count).mockResolvedValue(0);

      const res = await app.inject({
        method: 'GET',
        url: '/customers?search=06%2012%2034%2056%2078',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            restaurantId: 'test-rest-1',
            OR: [
              { name: { contains: '06 12 34 56 78', mode: 'insensitive' } },
              { emailNormalized: { contains: '06 12 34 56 78' } },
              { phone: { contains: '0612345678' } },
              { phone: { contains: '612345678' } },
            ],
          }),
        }),
      );
    });

    it('cherche aussi par nom', async () => {
      const app = await getApp();
      vi.mocked(db.customer.findMany).mockResolvedValue([]);
      vi.mocked(db.customer.count).mockResolvedValue(0);

      await app.inject({
        method: 'GET',
        url: '/customers?search=Martin',
        headers: { authorization: 'Bearer test' },
      });

      expect(db.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { name: { contains: 'Martin', mode: 'insensitive' } },
              { emailNormalized: { contains: 'martin' } },
            ],
          }),
        }),
      );
    });

    it('masque les notes pour un rôle non autorisé selon la politique du site', async () => {
      const app = await getApp();
      vi.mocked(db.customer.findMany).mockResolvedValue([
        {
          id: 'c1',
          restaurantId: 'test-rest-1',
          name: 'Alice',
          notes: 'Table calme',
        },
      ] as never);
      vi.mocked(db.customer.count).mockResolvedValue(1);
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        crmSensitiveNoteRoles: 'OWNER,MANAGER',
      } as never);
      vi.mocked(db.reservation.findMany).mockResolvedValue([] as never);

      const res = await app.inject({
        method: 'GET',
        url: '/customers',
        headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual([
        {
          id: 'c1',
          restaurantId: 'test-rest-1',
          name: 'Alice',
          notes: null,
          specialOccasion: null,
          lifecycle: { status: 'new', reason: 'Aucune visite pour l’instant' },
          visitSummary: { visits: 0, visits365d: 0, noShows365d: 0, lastVisitAt: null },
        },
      ]);
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
    it('interdit à STAFF de créer ou modifier une note client', async () => {
      const app = await getApp();

      const create = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
        payload: {
          restaurantId: 'ignored-by-auth',
          phone: '+33612345678',
          name: 'Alice',
          notes: 'Note privée',
        },
      });
      expect(create.statusCode).toBe(403);
      expect(create.json()).toEqual({
        error: 'CUSTOMER_NOTES_WRITE_ROLE_REQUIRED',
        message:
          'La modification des notes et de l’occasion spéciale est réservée aux rôles autorisés à les consulter.',
      });
      expect(db.customer.upsert).not.toHaveBeenCalled();

      const update = await app.inject({
        method: 'PATCH',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
        payload: { notes: 'Note privée' },
      });
      expect(update.statusCode).toBe(403);
      expect(db.customer.update).not.toHaveBeenCalled();
    });

    it('laisse STAFF écrire une note quand le site lui a ouvert la lecture des notes', async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        crmSensitiveNoteRoles: 'OWNER,STAFF',
      } as never);
      vi.mocked(db.customer.update).mockResolvedValue({
        id: 'c1',
        phone: '+33612345678',
        notes: 'Note',
      } as never);

      const res = await app.inject({
        method: 'PATCH',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
        payload: { notes: 'Note' },
      });

      expect(res.statusCode).toBe(200);
    });

    it("interdit d'écrire l'occasion spéciale à un rôle qui ne lit pas les notes", async () => {
      const app = await getApp();
      vi.mocked(db.restaurant.findUnique).mockResolvedValue({
        crmSensitiveNoteRoles: null,
      } as never);

      const res = await app.inject({
        method: 'PATCH',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test', 'x-test-site-role': 'STAFF' },
        payload: { specialOccasion: 'Divorce' },
      });

      expect(res.statusCode).toBe(403);
      expect(db.customer.update).not.toHaveBeenCalled();
    });

    it("crée un client (201) en E.164 avec le restaurantId issu de l'auth, pas du payload", async () => {
      const app = await getApp();
      const created = {
        id: 'c1',
        restaurantId: 'test-rest-1',
        phone: '+33612345678',
        name: 'Alice',
      };
      vi.mocked(db.customer.findFirst).mockResolvedValue(null);
      vi.mocked(db.customer.create).mockResolvedValue(created as never);

      const res = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
        payload: {
          restaurantId: 'other-rest-should-be-ignored',
          phone: '0612345678',
          name: 'Alice',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual(created);
      expect(db.customer.create).toHaveBeenCalledWith({
        data: { restaurantId: 'test-rest-1', phone: '+33612345678', name: 'Alice' },
      });
    });

    it("met à jour un client existant sans retirer son VIP ni vider ce qui n'est pas envoyé", async () => {
      const app = await getApp();
      vi.mocked(db.customer.findFirst).mockResolvedValue({ id: 'c1' } as never);
      vi.mocked(db.customer.update).mockResolvedValue({ id: 'c1', isVip: true } as never);

      const res = await app.inject({
        method: 'POST',
        url: '/customers',
        headers: { authorization: 'Bearer test' },
        payload: { restaurantId: 'test-rest-1', phone: '+33612345678', name: 'Alice' },
      });

      expect(res.statusCode).toBe(201);
      expect(db.customer.create).not.toHaveBeenCalled();
      expect(db.customer.update).toHaveBeenCalledWith({
        where: { id: 'c1', restaurantId: 'test-rest-1' },
        data: { name: 'Alice' },
      });
    });

    it('retourne 409 (Conflict) si Prisma soulève P2002 (création concurrente)', async () => {
      const app = await getApp();
      const prismaError = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
        code: 'P2002',
        clientVersion: '6.0.0',
      });
      vi.mocked(db.customer.findFirst).mockResolvedValue(null);
      vi.mocked(db.customer.create).mockRejectedValue(prismaError);

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
      vi.mocked(db.customer.findFirst).mockResolvedValue(null);
      vi.mocked(db.customer.create).mockRejectedValue(
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
      expect(db.customer.create).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /customers/:id', () => {
    it("retire l'ancienne identité email quand l'email est remplacé ou effacé", async () => {
      const app = await getApp();
      vi.mocked(db.customer.findFirst).mockResolvedValue({
        emailNormalized: 'old@example.com',
      } as never);
      vi.mocked(db.customer.update).mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000001',
        restaurantId: 'test-rest-1',
        phone: '+33612345678',
        emailNormalized: null,
      } as never);

      const res = await app.inject({
        method: 'PATCH',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test' },
        payload: { email: null },
      });

      expect(res.statusCode).toBe(200);
      expect(db.customerIdentity.deleteMany).toHaveBeenCalledWith({
        where: {
          restaurantId: 'test-rest-1',
          customerId: '00000000-0000-0000-0000-000000000001',
          type: 'EMAIL',
          normalizedValue: 'old@example.com',
        },
      });
    });

    it('met à jour + invalide le cache Redis (key customer:{rest}:{phone})', async () => {
      const app = await getApp();
      const updated = {
        id: 'c1',
        restaurantId: 'test-rest-1',
        phone: '+33612345678',
        name: 'Alice Updated',
      };
      vi.mocked(db.customer.update).mockResolvedValue(
        updated as unknown as Awaited<ReturnType<typeof db.customer.update>>,
      );
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
    it("n'existe plus : une suppression effacerait les refus marketing", async () => {
      const app = await getApp();

      const res = await app.inject({
        method: 'DELETE',
        url: '/customers/00000000-0000-0000-0000-000000000001',
        headers: { authorization: 'Bearer test' },
      });

      expect(res.statusCode).toBe(404);
      expect(db.customer.delete).not.toHaveBeenCalled();
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
      vi.mocked(db.customer.update).mockResolvedValue(
        updated as unknown as Awaited<ReturnType<typeof db.customer.update>>,
      );
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
