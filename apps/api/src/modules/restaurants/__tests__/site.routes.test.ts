import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { clerkClient } from '@clerk/fastify';

vi.mock('@clerk/fastify', () => ({
  clerkClient: {
    organizations: {
      getOrganizationMembershipList: vi.fn(),
    },
  },
}));

describe('restaurant routes — sites accessibles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('retourne les établissements visibles et le site actif', async () => {
    const app = await getApp();
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue({
      id: 'account_1',
      status: 'ACTIVE',
      restaurants: [
        {
          id: 'site_primary',
          name: 'Chez Sokar Lyon',
          siteStatus: 'ACTIVE',
          isPrimary: true,
          createdAt: new Date(1),
        },
        {
          id: 'site_two',
          name: 'Chez Sokar Paris',
          siteStatus: 'ACTIVE',
          isPrimary: false,
          createdAt: new Date(2),
        },
        {
          id: 'site_paused',
          name: 'Chez Sokar Lille',
          siteStatus: 'SUSPENDED',
          isPrimary: false,
          createdAt: new Date(3),
        },
      ],
      memberships: [{ restaurantId: null, clerkUserId: 'test-user-1', role: 'OWNER' }],
    } as never);

    const res = await app.inject({
      method: 'GET',
      url: '/restaurants/sites',
      headers: { authorization: 'Bearer test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      accountId: 'test-account-1',
      activeSiteId: 'test-rest-1',
      sites: [
        {
          id: 'site_primary',
          name: 'Chez Sokar Lyon',
          siteStatus: 'ACTIVE',
          isPrimary: true,
          role: 'OWNER',
        },
        {
          id: 'site_two',
          name: 'Chez Sokar Paris',
          siteStatus: 'ACTIVE',
          isPrimary: false,
          role: 'OWNER',
        },
        {
          id: 'site_paused',
          name: 'Chez Sokar Lille',
          siteStatus: 'SUSPENDED',
          isPrimary: false,
          role: 'OWNER',
        },
      ],
    });
  });

  it('ajoute un établissement pour le propriétaire dans le quota facturé', async () => {
    const app = await getApp();
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue({
      id: 'test-account-1',
      status: 'ACTIVE',
    } as never);
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      accountId: 'test-account-1',
      plan: 'PREMIUM',
    } as never);
    vi.mocked(db.restaurant.count).mockResolvedValue(1);
    vi.mocked(db.restaurantAccountBilling.findUnique).mockResolvedValue({
      entitledSiteCount: 2,
    } as never);
    vi.mocked(db.restaurant.create).mockResolvedValue({
      id: 'site_two',
      name: 'Chez Sokar Paris',
      siteStatus: 'ACTIVE',
      isPrimary: false,
    } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants/sites',
      headers: { authorization: 'Bearer test' },
      payload: { name: 'Chez Sokar Paris', phoneNumber: '+33123456789' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      id: 'site_two',
      name: 'Chez Sokar Paris',
      siteStatus: 'ACTIVE',
      isPrimary: false,
      role: 'OWNER',
    });
    expect(db.restaurant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: 'test-account-1',
        isPrimary: false,
        siteStatus: 'ACTIVE',
        name: 'Chez Sokar Paris',
        phoneNumber: '+33123456789',
        plan: 'PREMIUM',
      }),
    });
  });

  it('bloque l’ajout d’un site hors quota', async () => {
    const app = await getApp();
    vi.mocked(db.restaurantAccount.findUnique).mockResolvedValue({
      id: 'test-account-1',
      status: 'ACTIVE',
    } as never);
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      accountId: 'test-account-1',
      plan: 'PRO',
    } as never);
    vi.mocked(db.restaurant.count).mockResolvedValue(1);
    vi.mocked(db.restaurantAccountBilling.findUnique).mockResolvedValue({
      entitledSiteCount: 1,
    } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants/sites',
      headers: { authorization: 'Bearer test' },
      payload: { name: 'Site bloqué', phoneNumber: '+33198765432' },
    });

    expect(res.statusCode).toBe(402);
    expect(res.json().error).toBe('MULTI_SITE_SUBSCRIPTION_REQUIRED');
    expect(db.restaurant.create).not.toHaveBeenCalled();
  });

  it('refuse d’archiver le site principal s’il est le dernier actif', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      accountId: 'test-account-1',
      isPrimary: true,
      siteStatus: 'ACTIVE',
      name: 'Chez Sokar',
    } as never);
    vi.mocked(db.restaurant.count).mockResolvedValue(0);

    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurants/sites/test-rest-1',
      headers: { authorization: 'Bearer test' },
      payload: { siteStatus: 'ARCHIVED' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PRIMARY_SITE_REQUIRED');
    expect(db.restaurant.update).not.toHaveBeenCalled();
  });

  it('transfère le principal au plus ancien site actif avant sa suspension', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      accountId: 'test-account-1',
      isPrimary: true,
      siteStatus: 'ACTIVE',
      name: 'Chez Sokar',
    } as never);
    vi.mocked(db.restaurant.findFirst).mockResolvedValue({ id: 'site_two' } as never);
    vi.mocked(db.restaurant.update).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Chez Sokar',
      siteStatus: 'SUSPENDED',
      isPrimary: false,
    } as never);

    const res = await app.inject({
      method: 'PATCH',
      url: '/restaurants/sites/test-rest-1',
      headers: { authorization: 'Bearer test' },
      payload: { siteStatus: 'SUSPENDED' },
    });

    expect(res.statusCode).toBe(200);
    expect(db.restaurant.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'site_two' },
      data: { isPrimary: true },
    });
    expect(db.restaurant.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'test-rest-1' },
      data: { siteStatus: 'SUSPENDED', isPrimary: false },
      select: { id: true, name: true, siteStatus: true, isPrimary: true },
    });
  });

  it('n’ajoute un membre qu’après validation de son appartenance Clerk', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'site_two',
      accountId: 'test-account-1',
      siteStatus: 'ACTIVE',
    } as never);
    vi.mocked(clerkClient.organizations.getOrganizationMembershipList).mockResolvedValue({
      data: [{ publicUserData: { userId: 'user_2' } }],
    } as never);
    vi.mocked(db.restaurantAccountMembership.create).mockResolvedValue({
      id: 'membership_2',
      restaurantId: 'site_two',
      clerkUserId: 'user_2',
      role: 'STAFF',
    } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants/sites/site_two/members',
      headers: { authorization: 'Bearer test' },
      payload: { clerkUserId: 'user_2', role: 'STAFF' },
    });

    expect(res.statusCode).toBe(201);
    expect(clerkClient.organizations.getOrganizationMembershipList).toHaveBeenCalledWith({
      organizationId: 'test-rest-1',
      userId: ['user_2'],
      limit: 1,
    });
    expect(db.restaurantAccountMembership.create).toHaveBeenCalledWith({
      data: {
        accountId: 'test-account-1',
        restaurantId: 'site_two',
        clerkUserId: 'user_2',
        role: 'STAFF',
      },
    });
  });

  it('refuse un utilisateur absent de l’organisation Clerk sans écriture locale', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'site_two',
      accountId: 'test-account-1',
      siteStatus: 'ACTIVE',
    } as never);
    vi.mocked(clerkClient.organizations.getOrganizationMembershipList).mockResolvedValue({
      data: [],
    } as never);

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants/sites/site_two/members',
      headers: { authorization: 'Bearer test' },
      payload: { clerkUserId: 'user_outside', role: 'STAFF' },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({
      error: 'CLERK_MEMBER_REQUIRED',
      message: 'L’utilisateur doit d’abord appartenir à votre organisation Clerk.',
    });
    expect(db.restaurantAccountMembership.create).not.toHaveBeenCalled();
    expect(db.restaurantAccountMembership.update).not.toHaveBeenCalled();
  });

  it('bloque l’écriture si la vérification Clerk est indisponible', async () => {
    const app = await getApp();
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'site_two',
      accountId: 'test-account-1',
      siteStatus: 'ACTIVE',
    } as never);
    vi.mocked(clerkClient.organizations.getOrganizationMembershipList).mockRejectedValue(
      new Error('Clerk timeout'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/restaurants/sites/site_two/members',
      headers: { authorization: 'Bearer test' },
      payload: { clerkUserId: 'user_2', role: 'STAFF' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('CLERK_MEMBERSHIP_UNAVAILABLE');
    expect(db.restaurantAccountMembership.create).not.toHaveBeenCalled();
    expect(db.restaurantAccountMembership.update).not.toHaveBeenCalled();
  });
});
