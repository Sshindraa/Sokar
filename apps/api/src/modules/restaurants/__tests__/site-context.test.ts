import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveRestaurantContext, type RestaurantContextDb } from '../site-context';

function makeDatabase() {
  return {
    restaurantAccount: { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn() },
  } as unknown as RestaurantContextDb & {
    restaurantAccount: { findUnique: ReturnType<typeof vi.fn> };
    restaurant: { findUnique: ReturnType<typeof vi.fn> };
  };
}

describe('resolveRestaurantContext', () => {
  let database: ReturnType<typeof makeDatabase>;

  beforeEach(() => {
    database = makeDatabase();
    database.restaurantAccount.findUnique.mockResolvedValue(null);
    database.restaurant.findUnique.mockResolvedValue(null);
  });

  it('conserve le tenant historique sans compte multi-site', async () => {
    const context = await resolveRestaurantContext(database, {
      organizationId: 'org_legacy',
      userId: 'user_1',
    });

    expect(context).toEqual({
      clerkOrganizationId: 'org_legacy',
      siteId: 'org_legacy',
      role: 'ORG_MEMBER',
      legacy: true,
    });
  });

  it('refuse un site demandé hors du tenant historique', async () => {
    await expect(
      resolveRestaurantContext(database, {
        organizationId: 'org_legacy',
        requestedSiteId: 'other-site',
      }),
    ).rejects.toMatchObject({ code: 'SITE_ACCESS_DENIED' });
  });

  it('sélectionne un site demandé avec le rôle de compte', async () => {
    database.restaurantAccount.findUnique.mockResolvedValue({
      id: 'account_1',
      status: 'ACTIVE',
      restaurants: [
        { id: 'site_primary', siteStatus: 'ACTIVE', isPrimary: true, createdAt: new Date(1) },
        { id: 'site_two', siteStatus: 'ACTIVE', isPrimary: false, createdAt: new Date(2) },
      ],
      memberships: [{ restaurantId: null, clerkUserId: 'user_1', role: 'MANAGER' }],
    });

    const context = await resolveRestaurantContext(database, {
      organizationId: 'org_multi',
      userId: 'user_1',
      requestedSiteId: 'site_two',
    });

    expect(context).toEqual({
      accountId: 'account_1',
      clerkOrganizationId: 'org_multi',
      siteId: 'site_two',
      role: 'MANAGER',
      legacy: false,
    });
  });

  it('limite un membre à son site et choisit le site principal autorisé', async () => {
    database.restaurantAccount.findUnique.mockResolvedValue({
      id: 'account_1',
      status: 'ACTIVE',
      restaurants: [
        { id: 'site_primary', siteStatus: 'ACTIVE', isPrimary: true, createdAt: new Date(1) },
        { id: 'site_two', siteStatus: 'ACTIVE', isPrimary: false, createdAt: new Date(2) },
      ],
      memberships: [{ restaurantId: 'site_two', clerkUserId: 'user_1', role: 'STAFF' }],
    });

    const context = await resolveRestaurantContext(database, {
      organizationId: 'org_multi',
      userId: 'user_1',
    });

    expect(context.siteId).toBe('site_two');
    expect(context.role).toBe('STAFF');
    await expect(
      resolveRestaurantContext(database, {
        organizationId: 'org_multi',
        userId: 'user_1',
        requestedSiteId: 'site_primary',
      }),
    ).rejects.toMatchObject({ code: 'SITE_ACCESS_DENIED' });
  });

  it('refuse un utilisateur absent des memberships du compte', async () => {
    database.restaurantAccount.findUnique.mockResolvedValue({
      id: 'account_1',
      status: 'ACTIVE',
      restaurants: [
        { id: 'site_one', siteStatus: 'ACTIVE', isPrimary: true, createdAt: new Date(1) },
      ],
      memberships: [{ restaurantId: 'site_one', clerkUserId: 'other_user', role: 'STAFF' }],
    });

    await expect(
      resolveRestaurantContext(database, {
        organizationId: 'org_multi',
        userId: 'user_1',
      }),
    ).rejects.toMatchObject({ code: 'SITE_ACCESS_DENIED' });
  });

  it('refuse un compte suspendu et un site suspendu', async () => {
    database.restaurantAccount.findUnique.mockResolvedValueOnce({
      id: 'account_1',
      status: 'SUSPENDED',
      restaurants: [],
      memberships: [],
    });
    await expect(
      resolveRestaurantContext(database, { organizationId: 'org_multi' }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SUSPENDED' });

    database.restaurantAccount.findUnique.mockResolvedValueOnce({
      id: 'account_1',
      status: 'ACTIVE',
      restaurants: [
        { id: 'site_one', siteStatus: 'SUSPENDED', isPrimary: true, createdAt: new Date(1) },
      ],
      memberships: [],
    });
    await expect(
      resolveRestaurantContext(database, { organizationId: 'org_multi' }),
    ).rejects.toMatchObject({ code: 'SITE_UNAVAILABLE' });
  });
});
