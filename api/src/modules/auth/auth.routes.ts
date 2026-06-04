import { FastifyInstance } from 'fastify';
import { clerkClient, getAuth } from '@clerk/fastify';
import { db } from '../../shared/db/client';
import { redisCache } from '../../shared/redis/client';
import { queues } from '../../shared/queue/queues';

export async function authSyncRoutes(app: FastifyInstance) {
  /**
   * POST /api/auth/sync
   * Sync Clerk organization → Restaurant dans PostgreSQL.
   * Appelé depuis le dashboard après sign-up / login.
   */
  app.post('/api/auth/sync', async (req, reply) => {
    const { orgId, userId } = getAuth(req);

    if (!userId) {
      return reply.status(401).send({ error: 'Authentication required' });
    }
    if (!orgId) {
      return reply.status(400).send({ error: 'No organization found. Did you create one?' });
    }

    // Vérifier si le restaurant existe déjà
    const existing = await db.restaurant.findUnique({ where: { id: orgId } });
    if (existing) {
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

    // Créer le restaurant dans PostgreSQL
    const restaurant = await db.restaurant.create({
      data: {
        id: orgId,
        name: orgName,
        phoneNumber: `+000${orgSlug ?? orgId.slice(0, 8)}`, // placeholder — à configurer plus tard
        managerPhone: '',
        managerEmail: '',
        openingHours: {},
        plan: 'STARTER',
      },
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
