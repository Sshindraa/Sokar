/**
 * Tests for the dashboard reactivation routes.
 *
 * Les campaigns de réactivation (VIPs dormants) sont créées par un cron
 * hebdo en status PENDING. Le gérant les voit sur le dashboard et valide
 * l'envoi (POST /:id/send) ou les ignore (POST /:id/dismiss).
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getApp, closeApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';

const AUTH = { authorization: 'Bearer fake-token' };
const RESTAURANT_ID = 'test-rest-1';

describe('GET /dashboard/reactivation', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('retourne 401 sans auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/dashboard/reactivation' });
    expect(res.statusCode).toBe(401);
  });

  it('liste les campaigns avec customerCount + customers pour PENDING', async () => {
    vi.mocked(db.reactivationCampaign.findMany).mockResolvedValue([
      {
        id: 'camp-1',
        status: 'PENDING',
        sentCount: 0,
        sentAt: null,
        createdAt: new Date('2026-07-01'),
        customerIds: ['cust-1', 'cust-2'],
      } as never,
    ]);
    vi.mocked(db.customer.findMany).mockResolvedValue([
      {
        id: 'cust-1',
        name: 'Alice',
        phone: '+336****1111',
        visitCount: 12,
        lastSeenAt: new Date('2026-05-01'),
        isVip: true,
      } as never,
      {
        id: 'cust-2',
        name: null,
        phone: '+336****2222',
        visitCount: 5,
        lastSeenAt: new Date('2026-04-01'),
        isVip: false,
      } as never,
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/reactivation',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 'camp-1',
      status: 'PENDING',
      customerCount: 2,
    });
    const customers = body[0].customers as Array<{ name: string }>;
    expect(customers[0].name).toBe('Alice');
    // Customer sans nom → fallback "Client inconnu"
    expect(customers[1].name).toBe('Client inconnu');
  });

  it('gère une campaign avec customerIds vide (customers=[])', async () => {
    vi.mocked(db.reactivationCampaign.findMany).mockResolvedValue([
      {
        id: 'camp-empty',
        status: 'PENDING',
        sentCount: 0,
        sentAt: null,
        createdAt: new Date('2026-07-01'),
        customerIds: [],
      } as never,
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/dashboard/reactivation',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<Record<string, unknown>>;
    // La route ne définit pas customerCount quand customerIds est vide
    // (court-circuit avant la 2ème passe), mais customers est bien [].
    expect(body[0].customers).toEqual([]);
  });
});

describe('POST /dashboard/reactivation/:id/send', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it("retourne 404 si la campaign n'existe pas", async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/reactivation/missing/send',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  it("retourne 409 si la campaign n'est pas PENDING (déjà SENT/DISMISSED)", async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue({
      id: 'camp-1',
      restaurantId: RESTAURANT_ID,
      status: 'SENT',
      customerIds: [],
      sentCount: 3,
      sentAt: new Date(),
      createdAt: new Date(),
    } as never);
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/reactivation/camp-1/send',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(409);
    expect(queues.reactivation.add).not.toHaveBeenCalled();
  });

  it('enqueue le job reactivation.send avec le campaignId pour une campaign PENDING', async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue({
      id: 'camp-1',
      restaurantId: RESTAURANT_ID,
      status: 'PENDING',
      customerIds: ['cust-1'],
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
    } as never);
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/reactivation/camp-1/send',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, message: 'Envoi en cours' });
    expect(queues.reactivation.add).toHaveBeenCalledWith('send-campaign', {
      kind: 'send',
      campaignId: 'camp-1',
    });
  });
});

describe('POST /dashboard/reactivation/:id/dismiss', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await getApp();
  });

  afterAll(async () => {
    await closeApp();
  });

  it("retourne 404 si la campaign n'existe pas", async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue(null);
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/reactivation/missing/dismiss',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  it("retourne 409 si la campaign n'est pas PENDING", async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue({
      id: 'camp-1',
      restaurantId: RESTAURANT_ID,
      status: 'DISMISSED',
      customerIds: [],
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
    } as never);
    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/reactivation/camp-1/dismiss',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(409);
  });

  it('marque la campaign comme DISMISSED', async () => {
    vi.mocked(db.reactivationCampaign.findFirst).mockResolvedValue({
      id: 'camp-1',
      restaurantId: RESTAURANT_ID,
      status: 'PENDING',
      customerIds: [],
      sentCount: 0,
      sentAt: null,
      createdAt: new Date(),
    } as never);
    vi.mocked(db.reactivationCampaign.update).mockResolvedValue({} as never);

    const res = await app.inject({
      method: 'POST',
      url: '/dashboard/reactivation/camp-1/dismiss',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(db.reactivationCampaign.update).toHaveBeenCalledWith({
      where: { id: 'camp-1' },
      data: { status: 'DISMISSED' },
    });
  });
});
