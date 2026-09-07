import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@clerk/fastify';
import { db } from '../../shared/db/client';
import { requireOrg, requireSokarOperator } from '../clerk';

vi.mock('@clerk/fastify', () => ({
  clerkPlugin: vi.fn(),
  getAuth: vi.fn(),
}));

const originalEnv = {
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  demoRestaurantId: process.env.DEMO_RESTAURANT_ID,
  demoStaging: process.env.DEMO_STAGING,
  demoUserId: process.env.DEMO_USER_ID,
  operatorIds: process.env.SOKAR_OPERATOR_USER_IDS,
};

function makeRequest(
  method = 'GET',
  headers: Record<string, string> = { authorization: 'Bearer test' },
) {
  const log = {
    child: vi.fn(() => log),
    warn: vi.fn(),
  };
  return {
    method,
    headers,
    log,
  } as unknown as FastifyRequest;
}

function makeReply() {
  const reply = {
    sent: false,
    status: vi.fn(),
    send: vi.fn(),
  } as unknown as FastifyReply & { sent: boolean };
  vi.mocked(reply.status).mockImplementation(() => reply);
  vi.mocked(reply.send).mockImplementation(() => {
    reply.sent = true;
    return reply;
  });
  return reply;
}

describe('requireSokarOperator', () => {
  afterEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_PUBLISHABLE_KEY = originalEnv.clerkPublishableKey;
    process.env.CLERK_SECRET_KEY = originalEnv.clerkSecretKey;
    process.env.DEMO_RESTAURANT_ID = originalEnv.demoRestaurantId;
    process.env.DEMO_STAGING = originalEnv.demoStaging;
    process.env.DEMO_USER_ID = originalEnv.demoUserId;
    process.env.SOKAR_OPERATOR_USER_IDS = originalEnv.operatorIds;
  });

  function configure(userId: string | null, operatorIds = 'user-operator') {
    process.env.CLERK_PUBLISHABLE_KEY = 'pk_test';
    process.env.CLERK_SECRET_KEY = 'sk_test';
    delete process.env.DEMO_RESTAURANT_ID;
    delete process.env.DEMO_USER_ID;
    process.env.SOKAR_OPERATOR_USER_IDS = operatorIds;
    vi.mocked(getAuth).mockReturnValue({ userId } as never);
  }

  it('refuse une requête sans session', async () => {
    configure(null);
    const request = makeRequest();
    const reply = makeReply();

    await requireSokarOperator()(request, reply);

    expect(reply.status).toHaveBeenCalledWith(401);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  it('refuse un membre de restaurant qui ne figure pas dans la liste opérateur', async () => {
    configure('user-restaurant');
    const request = makeRequest();
    const reply = makeReply();

    await requireSokarOperator()(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({ error: 'Sokar operator access required' });
  });

  it('autorise uniquement un identifiant présent dans SOKAR_OPERATOR_USER_IDS', async () => {
    configure('user-operator', 'user-other,user-operator');
    const request = makeRequest();
    const reply = makeReply();

    await requireSokarOperator()(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.userId).toBe('user-operator');
  });

  it('bloque les mutations d’un membre READ_ONLY après résolution du site', async () => {
    configure('user-read-only');
    vi.mocked(getAuth).mockReturnValue({ orgId: 'org_1', userId: 'user-read-only' } as never);
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue({
      id: 'account_1',
      status: 'ACTIVE',
      restaurants: [
        {
          id: 'site_1',
          siteStatus: 'ACTIVE',
          isPrimary: true,
          createdAt: new Date(),
        },
      ],
      memberships: [{ restaurantId: 'site_1', clerkUserId: 'user-read-only', role: 'READ_ONLY' }],
    } as never);
    const request = makeRequest('PATCH', {
      authorization: 'Bearer test',
      'x-sokar-site-id': 'site_1',
    });
    const reply = makeReply();

    await requireOrg()(request, reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'READ_ONLY_ACCESS',
      message: 'Ce membre dispose d’un accès en lecture seule.',
    });
  });

  it('injecte le compte du restaurant démo pour les parcours multi-site staging', async () => {
    process.env.DEMO_RESTAURANT_ID = 'demo-restaurant';
    process.env.DEMO_STAGING = '1';
    process.env.DEMO_USER_ID = 'demo-user';
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      accountId: 'demo-account',
      siteStatus: 'ACTIVE',
    } as never);

    const request = makeRequest();
    const reply = makeReply();

    await requireOrg()(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.restaurantId).toBe('demo-restaurant');
    expect(request.siteId).toBe('demo-restaurant');
    expect(request.accountId).toBe('demo-account');
    expect(request.clerkOrganizationId).toBe('demo-restaurant');
    expect(request.userId).toBe('demo-user');
    expect(request.siteRole).toBe('OWNER');
  });
});
