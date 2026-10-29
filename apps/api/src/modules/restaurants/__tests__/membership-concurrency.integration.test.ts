import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
vi.unmock('@prisma/client');
vi.mock('../../../shared/db/client', async () => {
  const { PrismaClient } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
  return {
    db: new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.MEMBERSHIP_AUDIT_TEST_DATABASE_URL ??
            'postgresql://localhost/sokar_membership_audit_unused',
        },
      },
    }),
  };
});
vi.mock('@clerk/fastify', () => ({
  clerkClient: {
    organizations: {
      getOrganizationMembershipList: vi
        .fn()
        .mockResolvedValue({ data: [{ publicMetadata: { sokarRole: 'MANAGER' } }] }),
    },
  },
}));
import { db } from '../../../shared/db/client';
import { claimInvitedMembership, transferOwnership } from '../team.service';
import { lockAccountMemberships } from '../site-context';

const url = process.env.MEMBERSHIP_AUDIT_TEST_DATABASE_URL;
if (url) {
  const target = new URL(url);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_(membership|reservation)_audit_[a-z0-9_]+$/.test(target.pathname)
  )
    throw new Error('Dedicated local database required');
}
let accountId: string;
let siteId: string;
let organizationId: string;
let ownerId: string;
describe.skipIf(!url)('membership concurrency — PostgreSQL', () => {
  beforeAll(async () => {
    const tag = randomUUID();
    organizationId = `audit-${tag}`;
    const account = await db.restaurantAccount.create({
      data: { clerkOrganizationId: organizationId, name: 'Audit' },
    });
    accountId = account.id;
    ownerId = `owner-${tag}`;
    await db.restaurantAccountMembership.create({
      data: {
        accountId,
        restaurantId: null,
        clerkUserId: ownerId,
        role: 'OWNER',
      },
    });
    const site = await db.restaurant.create({
      data: {
        accountId,
        name: 'Audit',
        managerPhone: '',
        managerEmail: '',
        phoneNumber: `audit-${tag}`,
        openingHours: {},
      },
    });
    siteId = site.id;
  });
  afterAll(async () => {
    if (accountId) await db.restaurantAccountMembership.deleteMany({ where: { accountId } });
    if (siteId) await db.restaurant.delete({ where: { id: siteId } });
    if (accountId) await db.restaurantAccount.delete({ where: { id: accountId } });
    await db.$disconnect();
  });
  it('does not create a global grant while a site grant is being created', async () => {
    const userId = `user-${randomUUID()}`;
    let release!: () => void;
    let ready!: () => void;
    const locked = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const assignment = db.$transaction(async (tx) => {
      await lockAccountMemberships(tx, accountId);
      ready();
      await wait;
      await tx.restaurantAccountMembership.create({
        data: { accountId, restaurantId: siteId, clerkUserId: userId, role: 'STAFF' },
      });
    });
    await locked;
    const claim = claimInvitedMembership({ organizationId, userId });
    release();
    await assignment;
    expect(await claim).toBeNull();
    const grants = await db.restaurantAccountMembership.findMany({
      where: { accountId, clerkUserId: userId },
    });
    expect(grants.map((grant) => grant.restaurantId)).toEqual([siteId]);
  });
  it('creates only one account grant for concurrent invitation claims', async () => {
    const userId = `user-${randomUUID()}`;
    await Promise.all([
      claimInvitedMembership({ organizationId, userId }),
      claimInvitedMembership({ organizationId, userId }),
    ]);
    expect(
      await db.restaurantAccountMembership.count({ where: { accountId, clerkUserId: userId } }),
    ).toBe(1);
  });

  it('transfers ownership only once when two transfers race', async () => {
    const first = `target-${randomUUID()}`;
    const second = `target-${randomUUID()}`;
    await db.restaurantAccountMembership.createMany({
      data: [first, second].map((clerkUserId) => ({
        accountId,
        clerkUserId,
        restaurantId: null,
        role: 'STAFF',
      })),
    });
    const results = await Promise.allSettled(
      [first, second].map((targetUserId) =>
        transferOwnership({
          accountId,
          organizationId,
          actingUserId: ownerId,
          targetUserId,
          previousOwnerAccess: 'READ_ONLY',
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const owners = await db.restaurantAccountMembership.findMany({
      where: { accountId, restaurantId: null, role: 'OWNER' },
    });
    expect(owners).toHaveLength(1);
    expect([first, second]).toContain(owners[0].clerkUserId);
    expect(
      (
        await db.restaurantAccountMembership.findFirstOrThrow({
          where: { accountId, clerkUserId: ownerId, restaurantId: null },
        })
      ).role,
    ).toBe('READ_ONLY');
  });
});
