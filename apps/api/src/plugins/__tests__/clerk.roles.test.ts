import type { FastifyReply, FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuth } from '@clerk/fastify';
import { db } from '../../shared/db/client';
import { resetClaimMisses } from '../../modules/restaurants/team.service';
import { requireOrg } from '../clerk';

const clerk = vi.hoisted(() => ({ getOrganizationMembershipList: vi.fn() }));
vi.mock('@clerk/fastify', () => ({
  clerkPlugin: vi.fn(),
  getAuth: vi.fn(),
  clerkClient: { organizations: clerk },
}));

const originalEnv = {
  publishable: process.env.CLERK_PUBLISHABLE_KEY,
  secret: process.env.CLERK_SECRET_KEY,
  demo: process.env.DEMO_RESTAURANT_ID,
  nodeEnv: process.env.NODE_ENV,
};

function makeRequest(method: string, routeUrl: string) {
  const log = { child: vi.fn(() => log), warn: vi.fn() };
  return {
    method,
    headers: { authorization: 'Bearer test' },
    routeOptions: { url: routeUrl },
    log,
  } as unknown as FastifyRequest;
}

function makeReply() {
  const reply = { sent: false, status: vi.fn(), send: vi.fn() } as unknown as FastifyReply & {
    sent: boolean;
  };
  vi.mocked(reply.status).mockImplementation(() => reply);
  vi.mocked(reply.send).mockImplementation(() => {
    reply.sent = true;
    return reply;
  });
  return reply;
}

function account(memberships: Array<{ userId: string; role: string }>) {
  return {
    id: 'account_1',
    status: 'ACTIVE',
    restaurants: [{ id: 'site_1', siteStatus: 'ACTIVE', isPrimary: true, createdAt: new Date() }],
    memberships: memberships.map((m) => ({
      restaurantId: null,
      clerkUserId: m.userId,
      role: m.role,
    })),
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClaimMisses();
  process.env.NODE_ENV = 'production';
  process.env.CLERK_PUBLISHABLE_KEY = 'pk_test';
  process.env.CLERK_SECRET_KEY = 'sk_test';
  delete process.env.DEMO_RESTAURANT_ID;
});

afterEach(() => {
  process.env.NODE_ENV = originalEnv.nodeEnv;
  for (const [key, value] of [
    ['CLERK_PUBLISHABLE_KEY', originalEnv.publishable],
    ['CLERK_SECRET_KEY', originalEnv.secret],
    ['DEMO_RESTAURANT_ID', originalEnv.demo],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('requireOrg : rôles', () => {
  it('ferme à l’équipe de service une route de réglages', async () => {
    vi.mocked(getAuth).mockReturnValue({ orgId: 'org_1', userId: 'user_staff' } as never);
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_staff', role: 'STAFF' }]),
    );
    const reply = makeReply();

    await requireOrg()(makeRequest('PATCH', '/restaurants/:id'), reply);

    expect(reply.status).toHaveBeenCalledWith(403);
    expect(reply.send).toHaveBeenCalledWith({
      error: 'ROLE_FORBIDDEN',
      message: 'Votre rôle ne permet pas cette action.',
    });
  });

  it('laisse l’équipe de service placer un client sur le plan', async () => {
    vi.mocked(getAuth).mockReturnValue({ orgId: 'org_1', userId: 'user_staff' } as never);
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_staff', role: 'STAFF' }]),
    );
    const request = makeRequest('POST', '/restaurants/:id/floor-plan/walk-ins');
    const reply = makeReply();

    await requireOrg()(request, reply);

    expect(reply.status).not.toHaveBeenCalled();
    expect(request.siteRole).toBe('STAFF');
    expect(request.restaurantId).toBe('site_1');
  });

  it('un responsable garde l’accès aux réglages', async () => {
    vi.mocked(getAuth).mockReturnValue({ orgId: 'org_1', userId: 'user_manager' } as never);
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_manager', role: 'MANAGER' }]),
    );
    const reply = makeReply();

    await requireOrg()(makeRequest('PATCH', '/restaurants/:id'), reply);

    expect(reply.status).not.toHaveBeenCalled();
  });
});

describe('requireOrg : rattachement d’un invité', () => {
  beforeEach(() => {
    vi.mocked(getAuth).mockReturnValue({ orgId: 'org_1', userId: 'user_invited' } as never);
    vi.mocked(db.restaurantAccountMembership.findFirst).mockResolvedValue(null);
  });

  it('rattache l’invité avec le rôle de son invitation, puis le laisse entrer', async () => {
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_owner', role: 'OWNER' }]),
    );
    clerk.getOrganizationMembershipList.mockResolvedValue({
      data: [{ publicMetadata: { sokarRole: 'STAFF' } }],
    });
    // Après le rattachement, la résolution voit sa nouvelle membership.
    vi.mocked(db.restaurantAccount.findUnique)
      .mockResolvedValueOnce(account([{ userId: 'user_owner', role: 'OWNER' }]))
      .mockResolvedValueOnce({ id: 'account_1', status: 'ACTIVE' } as never)
      .mockResolvedValueOnce(
        account([
          { userId: 'user_owner', role: 'OWNER' },
          { userId: 'user_invited', role: 'STAFF' },
        ]),
      );
    const request = makeRequest('GET', '/reservations');
    const reply = makeReply();

    await requireOrg()(request, reply);

    expect(db.restaurantAccountMembership.create).toHaveBeenCalledWith({
      data: {
        accountId: 'account_1',
        restaurantId: null,
        clerkUserId: 'user_invited',
        role: 'STAFF',
      },
    });
    expect(reply.status).not.toHaveBeenCalled();
    expect(request.siteRole).toBe('STAFF');
  });

  it('refuse quelqu’un de l’organisation que personne n’a invité', async () => {
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_owner', role: 'OWNER' }]),
    );
    clerk.getOrganizationMembershipList.mockResolvedValue({ data: [{ publicMetadata: {} }] });
    const reply = makeReply();

    await requireOrg()(makeRequest('GET', '/reservations'), reply);

    expect(db.restaurantAccountMembership.create).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(reply.send).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'SITE_ACCESS_DENIED' }),
    );
  });

  it('ne donne jamais le rôle propriétaire par invitation', async () => {
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_owner', role: 'OWNER' }]),
    );
    clerk.getOrganizationMembershipList.mockResolvedValue({
      data: [{ publicMetadata: { sokarRole: 'OWNER' } }],
    });
    const reply = makeReply();

    await requireOrg()(makeRequest('GET', '/reservations'), reply);

    expect(db.restaurantAccountMembership.create).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(404);
  });

  it('refuse sans rappeler Clerk à chaque requête pendant une minute', async () => {
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_owner', role: 'OWNER' }]),
    );
    clerk.getOrganizationMembershipList.mockResolvedValue({ data: [] });

    await requireOrg()(makeRequest('GET', '/reservations'), makeReply());
    await requireOrg()(makeRequest('GET', '/reservations'), makeReply());

    expect(clerk.getOrganizationMembershipList).toHaveBeenCalledTimes(1);
  });

  it('refuse (sans rien accorder) quand Clerk est indisponible', async () => {
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue(
      account([{ userId: 'user_owner', role: 'OWNER' }]),
    );
    clerk.getOrganizationMembershipList.mockRejectedValue(new Error('Clerk indisponible'));
    const reply = makeReply();

    await requireOrg()(makeRequest('GET', '/reservations'), reply);

    expect(db.restaurantAccountMembership.create).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(404);
  });
});
