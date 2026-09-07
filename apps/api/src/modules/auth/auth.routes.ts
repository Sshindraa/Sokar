import { FastifyInstance } from 'fastify';
import { clerkClient } from '@clerk/fastify';
import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { requireOrg } from '../../plugins/clerk';

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
      // Le backfill historique ne connaît pas l'utilisateur Clerk qui était
      // propriétaire. Le premier sync post-backfill crée donc un OWNER
      // uniquement si le compte ne possède encore aucune membership. Un
      // membre déjà présent ne peut pas être promu par un simple refresh.
      if (existing.accountId && req.userId) {
        const accountMembership = await db.restaurantAccountMembership.findFirst({
          where: { accountId: existing.accountId },
        });
        if (!accountMembership) {
          await db.restaurantAccountMembership.create({
            data: {
              accountId: existing.accountId,
              restaurantId: null,
              clerkUserId: req.userId,
              role: 'OWNER',
            },
          });
        }
      }
      return reply.send({ synced: true, restaurant: existing });
    }

    // Récupérer les infos de l'organisation Clerk
    let orgName = 'Mon Restaurant';
    let orgSlug: string | undefined;
    try {
      const org = await clerkClient.organizations.getOrganization({ organizationId: orgId });
      orgName = org.name || orgName;
      orgSlug = org.slug;
    } catch (err) {
      req.log.warn({ err, orgId }, 'Failed to fetch Clerk org details, using defaults');
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

      if (req.userId) {
        const existingMembership = await tx.restaurantAccountMembership.findFirst({
          where: { accountId: account.id, restaurantId: null, clerkUserId: req.userId },
        });
        if (existingMembership) {
          await tx.restaurantAccountMembership.update({
            where: { id: existingMembership.id },
            data: { role: 'OWNER' },
          });
        } else {
          await tx.restaurantAccountMembership.create({
            data: {
              accountId: account.id,
              restaurantId: null,
              clerkUserId: req.userId,
              role: 'OWNER',
            },
          });
        }
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
    return reply.status(201).send({ synced: true, restaurant });
  });
}
