import { FastifyInstance } from 'fastify';
import { clerkClient } from '@clerk/fastify';
import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { requireOrg } from '../../plugins/clerk';
import { lockAccountMemberships } from '../restaurants/site-context';

export async function authSyncRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/sync
   * Sync Clerk organization → Restaurant dans PostgreSQL.
   * Appelé depuis le dashboard après sign-up / login.
   */
  app.post('/api/auth/sync', { preHandler: requireOrg() }, async (req, reply) => {
    const orgId = req.restaurantId;

    // Vérifier si le restaurant existe déjà
    const existing = await db.restaurant.findUnique({ where: { id: orgId } });
    if (existing) {
      if (existing.accountId && req.userId) {
        const accountMembership = await db.restaurantAccountMembership.findFirst({
          where: { accountId: existing.accountId },
        });
        if (!accountMembership) {
          let creator: string | undefined;
          try {
            const org = await clerkClient.organizations.getOrganization({
              organizationId: req.clerkOrganizationId!,
            });
            creator = org.createdBy;
          } catch {
            return reply.status(503).send({ error: 'OWNER_VERIFICATION_UNAVAILABLE' });
          }
          if (!creator || creator !== req.userId)
            return reply.status(403).send({ error: 'OWNER_VERIFICATION_REQUIRED' });
          const bootstrapped = await db.$transaction(async (tx) => {
            await lockAccountMemberships(tx, existing.accountId!);
            const any = await tx.restaurantAccountMembership.findFirst({
              where: { accountId: existing.accountId! },
            });
            if (any) return true;
            const transfer = await tx.reservationAuditLog.findFirst({
              where: {
                event: 'account_ownership_transferred',
                metadata: { path: ['accountId'], equals: existing.accountId! },
              },
              select: { id: true },
            });
            if (transfer) return false;
            await tx.restaurantAccountMembership.create({
              data: {
                accountId: existing.accountId!,
                restaurantId: null,
                clerkUserId: req.userId!,
                role: 'OWNER',
              },
            });
            return true;
          });
          if (!bootstrapped)
            return reply.status(403).send({ error: 'OWNER_VERIFICATION_REQUIRED' });
        }
      }
      return reply.send({ synced: true, restaurant: existing });
    }

    // Le premier propriétaire doit être le créateur vérifié de l'organisation.
    let orgName = 'Mon Restaurant';
    let orgSlug: string | undefined;
    try {
      const org = await clerkClient.organizations.getOrganization({
        organizationId: req.clerkOrganizationId ?? orgId,
      });
      if (!req.userId || !org.createdBy || org.createdBy !== req.userId) {
        return reply.status(403).send({ error: 'OWNER_VERIFICATION_REQUIRED' });
      }
      orgName = org.name || orgName;
      orgSlug = org.slug;
    } catch {
      return reply.status(503).send({ error: 'OWNER_VERIFICATION_UNAVAILABLE' });
    }

    // Le compte, son propriétaire initial et le premier établissement doivent
    // être créés dans la même transaction. Sinon un timeout ou une contrainte
    // concurrente peut laisser un compte sans site ou sans propriétaire.
    const restaurant = await db.$transaction(async (tx) => {
      // Le compte commercial est créé avant le premier établissement. Cette
      // relation additive permet au resolver multi-site de conserver l'ID Clerk
      // historique comme clé de rattachement sans changer les routes existantes.
      const account = await tx.restaurantAccount.upsert({
        where: { clerkOrganizationId: orgId },
        create: { clerkOrganizationId: orgId, name: orgName },
        update: { name: orgName },
      });
      await lockAccountMemberships(tx, account.id);

      if (req.userId) {
        const existingMembership = await tx.restaurantAccountMembership.findFirst({
          where: { accountId: account.id },
        });
        if (existingMembership) throw new Error('Account already has memberships');
        await tx.restaurantAccountMembership.create({
          data: {
            accountId: account.id,
            restaurantId: null,
            clerkUserId: req.userId,
            role: 'OWNER',
          },
        });
      }

      // Créer le restaurant dans PostgreSQL
      return tx.restaurant.create({
        data: {
          id: orgId,
          accountId: account.id,
          isPrimary: true,
          siteStatus: 'ACTIVE',
          name: orgName,
          phoneNumber: `+000${orgSlug ?? orgId.slice(0, 8)}`, // placeholder — à configurer plus tard
          managerPhone: '',
          managerEmail: '',
          openingHours: {},
          plan: 'STARTER',
          provisioningStatus: 'PENDING',
        },
      });
    });

    // Planifier le rapport du soir
    try {
      await queues.eveningReport.upsertJobScheduler(
        `nightly-${restaurant.id}`,
        { pattern: '0 23 * * *', tz: 'Europe/Paris' },
        { name: 'nightly', data: { restaurantId: restaurant.id } },
      );
    } catch (err) {
      req.log.warn({ err }, 'Failed to schedule evening report');
    }

    req.log.info({ orgId, orgName }, 'Restaurant created from Clerk organization');
    return reply.status(201).send({ synced: true, restaurant: restaurant });
  });
}
