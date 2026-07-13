import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';
import { clerkClient } from '@clerk/fastify';

vi.mock('@clerk/fastify', () => ({
  clerkClient: {
    organizations: {
      getOrganization: vi.fn(),
    },
  },
}));

describe('auth.routes - POST /api/auth/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('retourne le restaurant existant sans rien créer', async () => {
    const app = await getApp();
    const existing = {
      id: 'test-rest-1',
      name: 'Bistrot du Coin',
      phoneNumber: '+336****0000',
    };
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(
      existing as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sync',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ synced: true, restaurant: existing });
    expect(db.restaurant.create).not.toHaveBeenCalled();
    expect(clerkClient.organizations.getOrganization).not.toHaveBeenCalled();
  });

  it('crée un restaurant depuis Clerk (nom + slug) et schedule le rapport du soir', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);
    vi.mocked(clerkClient.organizations.getOrganization).mockResolvedValue({
      name: 'Le Bistrot',
      slug: 'le-bistrot',
    } as unknown as Awaited<ReturnType<typeof clerkClient.organizations.getOrganization>>);
    const created = {
      id: 'test-rest-1',
      name: 'Le Bistrot',
      phoneNumber: '+000le-bistro',
      managerPhone: '',
      managerEmail: '',
      openingHours: {},
      plan: 'STARTER',
    };
    vi.mocked(db.restaurant.create).mockResolvedValue(
      created as unknown as Awaited<ReturnType<typeof db.restaurant.create>>,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sync',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.synced).toBe(true);
    expect(body.restaurant).toEqual(created);

    expect(db.restaurant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'test-rest-1',
        name: 'Le Bistrot',
        plan: 'STARTER',
      }),
    });
    expect(queues.eveningReport.upsertJobScheduler).toHaveBeenCalledWith(
      'nightly-test-rest-1',
      { pattern: '0 23 * * *', tz: 'Europe/Paris' },
      { name: 'nightly', data: { restaurantId: 'test-rest-1' } },
    );
  });

  it('utilise des valeurs par défaut si Clerk renvoie une erreur', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);
    vi.mocked(clerkClient.organizations.getOrganization).mockRejectedValue(new Error('Clerk down'));
    vi.mocked(db.restaurant.create).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Mon Restaurant',
      phoneNumber: '+000test-res',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.create>>);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sync',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(201);
    expect(db.restaurant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'test-rest-1',
        name: 'Mon Restaurant',
        // fallback phoneNumber: prefix from orgId.slice(0,8)
        phoneNumber: expect.stringMatching(/^\+000test-res$/),
      }),
    });
  });

  it('crée le restaurant même si la planification du rapport échoue (best-effort)', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue(null);
    vi.mocked(clerkClient.organizations.getOrganization).mockResolvedValue({
      name: 'X',
      slug: 'x',
    } as unknown as Awaited<ReturnType<typeof clerkClient.organizations.getOrganization>>);
    vi.mocked(db.restaurant.create).mockResolvedValue({
      id: 'test-rest-1',
      name: 'X',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.create>>);
    vi.mocked(queues.eveningReport.upsertJobScheduler).mockRejectedValue(new Error('Redis down'));

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sync',
      headers: { authorization: 'Bearer test' },
    });

    // Le restaurant est créé et la réponse 201 part — l'erreur de scheduling
    // est juste loggée, elle ne remonte pas.
    expect(res.statusCode).toBe(201);
    expect(db.restaurant.create).toHaveBeenCalled();
    expect(queues.eveningReport.upsertJobScheduler).toHaveBeenCalled();
  });

  it('retourne 401 sans en-tête Authorization (auth guard)', async () => {
    const app = await getApp();

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sync',
    });

    expect(res.statusCode).toBe(401);
  });
});
