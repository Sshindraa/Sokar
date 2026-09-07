/**
 * Résolution du contexte d'accès compte → établissement.
 *
 * Les routes historiques continuent de consommer restaurantId. Ce resolver
 * fournit le site actif et le rôle sans considérer un identifiant d'URL comme
 * une preuve d'appartenance.
 */

export type RestaurantSiteRole = 'OWNER' | 'MANAGER' | 'STAFF' | 'READ_ONLY' | 'ORG_MEMBER';

export type RestaurantContext = {
  accountId?: string;
  clerkOrganizationId: string;
  siteId: string;
  role: RestaurantSiteRole;
  legacy: boolean;
};

type AccountSite = {
  id: string;
  name?: string;
  siteStatus: string;
  isPrimary: boolean;
  createdAt: Date | string;
};

type AccountMembership = {
  restaurantId: string | null;
  clerkUserId: string;
  role: string;
};

type AccountRecord = {
  id: string;
  status: string;
  restaurants: AccountSite[];
  memberships: AccountMembership[];
};

type LegacyRestaurant = {
  id: string;
  name?: string;
  accountId: string | null;
  siteStatus: string;
  isPrimary?: boolean;
};

export type RestaurantSiteSummary = {
  id: string;
  name: string;
  siteStatus: string;
  isPrimary: boolean;
  role: RestaurantSiteRole;
};

/** Minimal repository contract so the resolver stays unit-testable. */
export type RestaurantContextDb = {
  restaurantAccount: {
    findUnique(args: unknown): Promise<unknown>;
  };
  restaurant: {
    findUnique(args: unknown): Promise<unknown>;
  };
};

export type RestaurantContextErrorCode =
  | 'ACCOUNT_SUSPENDED'
  | 'ACCOUNT_NOT_FOUND'
  | 'SITE_ACCESS_DENIED'
  | 'SITE_UNAVAILABLE';

export class RestaurantContextError extends Error {
  constructor(
    readonly code: RestaurantContextErrorCode,
    message = 'Restaurant context unavailable',
  ) {
    super(message);
    this.name = 'RestaurantContextError';
  }
}

const ROLE_RANK: Record<RestaurantSiteRole, number> = {
  OWNER: 4,
  MANAGER: 3,
  STAFF: 2,
  READ_ONLY: 1,
  ORG_MEMBER: 0,
};

function normalizeRole(value: string | null | undefined): RestaurantSiteRole {
  if (value === 'OWNER' || value === 'MANAGER' || value === 'STAFF' || value === 'READ_ONLY') {
    return value;
  }
  return 'ORG_MEMBER';
}

function mergeRoles(...roles: Array<string | null | undefined>): RestaurantSiteRole {
  return (
    roles.map(normalizeRole).sort((left, right) => ROLE_RANK[right] - ROLE_RANK[left])[0] ??
    'ORG_MEMBER'
  );
}

function isSelectableSite(site: AccountSite): boolean {
  return site.siteStatus !== 'SUSPENDED' && site.siteStatus !== 'ARCHIVED';
}

function sortSites(sites: AccountSite[]): AccountSite[] {
  return [...sites].sort((left, right) => {
    if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });
}

function requestedSiteIsAllowed(
  requestedSiteId: string | undefined,
  site: AccountSite,
  accountMembership: AccountMembership | undefined,
  siteMembership: AccountMembership | undefined,
  hasMembershipRows: boolean,
): boolean {
  if (!requestedSiteId || requestedSiteId === site.id) {
    return Boolean(accountMembership || siteMembership || !hasMembershipRows);
  }
  return false;
}

/**
 * Resolve the active site for an authenticated Clerk organization.
 *
 * During the additive migration, an organization without a RestaurantAccount
 * falls back to its historical restaurant ID. This preserves the existing
 * single-site routes while every newly provisioned account uses the stricter
 * membership path.
 */
export async function resolveRestaurantContext(
  database: RestaurantContextDb,
  input: {
    organizationId: string;
    userId?: string | null;
    requestedSiteId?: string | null;
  },
): Promise<RestaurantContext> {
  const organizationId = input.organizationId.trim();
  const requestedSiteId = input.requestedSiteId?.trim() || undefined;
  const userId = input.userId?.trim() || undefined;

  if (!organizationId) {
    throw new RestaurantContextError('ACCOUNT_NOT_FOUND');
  }

  const account = (await database.restaurantAccount.findUnique({
    where: { clerkOrganizationId: organizationId },
    select: {
      id: true,
      status: true,
      restaurants: {
        where: { siteStatus: { not: 'ARCHIVED' } },
        select: { id: true, siteStatus: true, isPrimary: true, createdAt: true },
      },
      memberships: {
        select: { restaurantId: true, clerkUserId: true, role: true },
      },
    },
  })) as AccountRecord | null;

  if (!account) {
    const legacy = (await database.restaurant.findUnique({
      where: { id: organizationId },
      select: { id: true, accountId: true, siteStatus: true },
    })) as LegacyRestaurant | null;

    // Before the account backfill, the Clerk organization ID remains the
    // tenant ID. Keep that route-compatible fallback until migration is done.
    if (!legacy) {
      if (requestedSiteId && requestedSiteId !== organizationId) {
        throw new RestaurantContextError('SITE_ACCESS_DENIED');
      }
      return {
        clerkOrganizationId: organizationId,
        siteId: organizationId,
        role: 'ORG_MEMBER',
        legacy: true,
      };
    }

    if (legacy.accountId) {
      throw new RestaurantContextError('ACCOUNT_NOT_FOUND');
    }
    if (legacy.siteStatus === 'SUSPENDED' || legacy.siteStatus === 'ARCHIVED') {
      throw new RestaurantContextError('SITE_UNAVAILABLE');
    }
    if (requestedSiteId && requestedSiteId !== legacy.id) {
      throw new RestaurantContextError('SITE_ACCESS_DENIED');
    }
    return {
      clerkOrganizationId: organizationId,
      siteId: legacy.id,
      role: 'ORG_MEMBER',
      legacy: true,
    };
  }

  if (account.status !== 'ACTIVE') {
    throw new RestaurantContextError('ACCOUNT_SUSPENDED');
  }

  const selectableSites = sortSites(account.restaurants.filter(isSelectableSite));
  if (selectableSites.length === 0) {
    throw new RestaurantContextError('SITE_UNAVAILABLE');
  }

  // Load all rows so a user with no assignment cannot be mistaken for an
  // account with no membership policy and receive access to every site.
  const memberships = userId
    ? account.memberships.filter((membership) => membership.clerkUserId === userId)
    : [];
  const accountMembership = memberships.find((membership) => membership.restaurantId === null);
  const hasMembershipRows = account.memberships.length > 0;
  const siteMemberships = new Map(
    memberships
      .filter((membership) => membership.restaurantId)
      .map((membership) => [membership.restaurantId as string, membership]),
  );

  const allowedSites = selectableSites.filter((site) =>
    requestedSiteIsAllowed(
      requestedSiteId,
      site,
      accountMembership,
      siteMemberships.get(site.id),
      hasMembershipRows,
    ),
  );

  if (allowedSites.length === 0) {
    throw new RestaurantContextError('SITE_ACCESS_DENIED');
  }

  const selectedSite = requestedSiteId
    ? allowedSites.find((site) => site.id === requestedSiteId)
    : allowedSites[0];
  if (!selectedSite) {
    throw new RestaurantContextError('SITE_ACCESS_DENIED');
  }

  return {
    accountId: account.id,
    clerkOrganizationId: organizationId,
    siteId: selectedSite.id,
    role: mergeRoles(accountMembership?.role, siteMemberships.get(selectedSite.id)?.role),
    legacy: false,
  };
}

/** Liste les établissements visibles par un membre pour le sélecteur dashboard. */
export async function listAccessibleRestaurantSites(
  database: RestaurantContextDb,
  input: { organizationId: string; userId?: string | null },
): Promise<RestaurantSiteSummary[]> {
  const organizationId = input.organizationId.trim();
  const userId = input.userId?.trim() || undefined;
  if (!organizationId) throw new RestaurantContextError('ACCOUNT_NOT_FOUND');

  const account = (await database.restaurantAccount.findUnique({
    where: { clerkOrganizationId: organizationId },
    select: {
      id: true,
      status: true,
      restaurants: {
        where: { siteStatus: { not: 'ARCHIVED' } },
        select: { id: true, name: true, siteStatus: true, isPrimary: true, createdAt: true },
      },
      memberships: {
        select: { restaurantId: true, clerkUserId: true, role: true },
      },
    },
  })) as AccountRecord | null;

  if (!account) {
    const legacy = (await database.restaurant.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true, accountId: true, siteStatus: true, isPrimary: true },
    })) as LegacyRestaurant | null;
    if (!legacy) {
      return [
        {
          id: organizationId,
          name: organizationId,
          siteStatus: 'ACTIVE',
          isPrimary: true,
          role: 'ORG_MEMBER',
        },
      ];
    }
    if (legacy.accountId) throw new RestaurantContextError('ACCOUNT_NOT_FOUND');
    if (legacy.siteStatus === 'SUSPENDED' || legacy.siteStatus === 'ARCHIVED') {
      throw new RestaurantContextError('SITE_UNAVAILABLE');
    }
    return [
      {
        id: legacy.id,
        name: legacy.name ?? legacy.id,
        siteStatus: legacy.siteStatus,
        isPrimary: legacy.isPrimary ?? true,
        role: 'ORG_MEMBER',
      },
    ];
  }

  if (account.status !== 'ACTIVE') throw new RestaurantContextError('ACCOUNT_SUSPENDED');

  const memberships = userId
    ? account.memberships.filter((membership) => membership.clerkUserId === userId)
    : [];
  const hasMembershipRows = account.memberships.length > 0;
  const accountMembership = memberships.find((membership) => membership.restaurantId === null);
  const siteMemberships = new Map(
    memberships
      .filter((membership) => membership.restaurantId)
      .map((membership) => [membership.restaurantId as string, membership]),
  );

  // The selector response keeps suspended sites visible to an owner so they
  // can be reactivated. The resolver above still excludes them from an active
  // request context; the dashboard filters them out of the actual selector.
  const sites = sortSites(account.restaurants).filter((site) => {
    return Boolean(accountMembership || siteMemberships.has(site.id) || !hasMembershipRows);
  });
  if (sites.length === 0) throw new RestaurantContextError('SITE_ACCESS_DENIED');

  return sites.map((site) => ({
    id: site.id,
    name: site.name ?? site.id,
    siteStatus: site.siteStatus,
    isPrimary: site.isPrimary,
    role: mergeRoles(accountMembership?.role, siteMemberships.get(site.id)?.role),
  }));
}
