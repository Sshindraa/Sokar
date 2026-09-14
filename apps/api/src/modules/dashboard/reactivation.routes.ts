import { MarketingCampaignStatus } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { requireOrg } from '../../plugins/clerk';
import { requireCapability } from '../entitlements/entitlement.guard';
import { migrateLegacyReactivationCampaign } from '../marketing/legacy-reactivation.service';

const requireReactivation = [requireOrg(), requireCapability('reactivation.manage')];

async function requireReactivationWriteRole(
  request: { siteRole?: string },
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
) {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'REACTIVATION_WRITE_ROLE_REQUIRED',
    message: 'La validation et le rejet d’une réactivation sont réservés aux responsables.',
  });
}

const requireReactivationWrite = [
  requireOrg(),
  requireCapability('reactivation.manage'),
  requireReactivationWriteRole,
];

function displayStatus(campaign: {
  status: string;
  marketingCampaign?: {
    status: MarketingCampaignStatus;
  } | null;
}): string {
  const linkedStatus = campaign.marketingCampaign?.status;
  if (!linkedStatus) return campaign.status;
  if (linkedStatus === MarketingCampaignStatus.SENT) return 'SENT';
  if (linkedStatus === MarketingCampaignStatus.FAILED) return 'FAILED';
  if (linkedStatus === MarketingCampaignStatus.CANCELLED) return 'CANCELLED';
  return 'MIGRATED';
}

/**
 * Routes pour la réactivation des VIPs dormants (semi-automatique).
 *
 * Le cron hebdo crée des campaigns PENDING. Le gérant voit la liste
 * sur le dashboard et valide l'envoi des SMS.
 */

export async function reactivationRoutes(app: FastifyInstance) {
  // Liste les campaigns PENDING + SENT (historique)
  app.get('/dashboard/reactivation', { preHandler: requireReactivation }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    const campaigns = await db.reactivationCampaign.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        marketingCampaign: {
          select: {
            id: true,
            status: true,
            acceptedCount: true,
            failedCount: true,
            completedAt: true,
            lastErrorCode: true,
          },
        },
      },
    });

    // Pour les campaigns PENDING, charger les détails des VIPs
    // Une seule query pour tous les customers (évite un N+1 : un findMany par campaign).
    const allCustomerIds = campaigns.flatMap((c) => c.customerIds);
    const allCustomers =
      allCustomerIds.length > 0
        ? await db.customer.findMany({
            where: { restaurantId, id: { in: allCustomerIds } },
            select: {
              id: true,
              name: true,
              phone: true,
              visitCount: true,
              lastSeenAt: true,
              isVip: true,
            },
          })
        : [];
    const customerMap = new Map(allCustomers.map((c) => [c.id, c]));

    const result = campaigns.map((campaign) => {
      const linked = campaign.marketingCampaign;
      const status = displayStatus(campaign);
      const sentCount = linked?.acceptedCount ?? campaign.sentCount;
      const sentAt = linked?.completedAt ?? campaign.sentAt;
      if (campaign.customerIds.length === 0) {
        return {
          id: campaign.id,
          status,
          sentCount,
          sentAt,
          createdAt: campaign.createdAt,
          customerCount: 0,
          marketingCampaignId: linked?.id ?? null,
          marketingCampaignStatus: linked?.status ?? null,
          lastErrorCode: linked?.lastErrorCode ?? null,
          customers: [],
        };
      }

      const customers = campaign.customerIds
        .map((id) => customerMap.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c);

      return {
        id: campaign.id,
        status,
        sentCount,
        sentAt,
        createdAt: campaign.createdAt,
        customerCount: campaign.customerIds.length,
        marketingCampaignId: linked?.id ?? null,
        marketingCampaignStatus: linked?.status ?? null,
        lastErrorCode: linked?.lastErrorCode ?? null,
        customers: customers.map((c) => ({
          id: c.id,
          name: c.name || 'Client inconnu',
          phone: c.phone,
          visitCount: c.visitCount,
          lastSeenAt: c.lastSeenAt,
        })),
      };
    });

    return reply.send(result);
  });

  // Valider l'envoi d'une campaign PENDING
  app.post(
    '/dashboard/reactivation/:id/send',
    { preHandler: requireReactivationWrite },
    async (req, reply) => {
      const restaurantId = req.restaurantId as string;
      const { id } = req.params as { id: string };

      const current = await db.reactivationCampaign.findFirst({
        where: { id, restaurantId },
        select: { status: true, marketingCampaignId: true },
      });
      if (!current) {
        return reply.status(404).send({ error: 'Campagne introuvable' });
      }
      if (!current.marketingCampaignId && current.status !== 'PENDING') {
        return reply.status(409).send({ error: 'Cette campagne a déjà été traitée' });
      }
      if (!current.marketingCampaignId) {
        const dormantAutomation = await db.marketingAutomation.findFirst({
          where: { restaurantId, type: 'DORMANT', enabled: true },
          select: { id: true },
        });
        if (dormantAutomation) {
          return reply.status(409).send({ error: 'REACTIVATION_AUTOMATION_ACTIVE' });
        }
      }

      // The legacy sender had no consent/suppression/frequency gate. Keep the
      // old route behind the same global freeze as governed campaigns before
      // creating or queueing anything.
      if (process.env.MARKETING_SENDS_ENABLED !== 'true') {
        return reply.status(503).send({ error: 'MARKETING_SENDS_DISABLED' });
      }

      let migration;
      try {
        migration = await migrateLegacyReactivationCampaign({
          restaurantId,
          reactivationCampaignId: id,
          actor: req.userId ?? undefined,
        });
        if (migration.campaign.status === MarketingCampaignStatus.CANCELLED) {
          return reply.status(409).send({
            error: 'REACTIVATION_AUDIENCE_EMPTY',
            campaignId: migration.marketingCampaignId,
          });
        }
        if (migration.campaign.status === MarketingCampaignStatus.SENT) {
          return reply.status(409).send({ error: 'Cette campagne a déjà été traitée' });
        }
      } catch (error) {
        if (error instanceof Error) {
          if (error.message === 'REACTIVATION_CAMPAIGN_NOT_FOUND') {
            return reply.status(404).send({ error: 'Campagne introuvable' });
          }
          if (error.message === 'REACTIVATION_CAMPAIGN_NOT_PENDING') {
            return reply.status(409).send({ error: 'Cette campagne a déjà été traitée' });
          }
          if (error.message.startsWith('REACTIVATION_AUDIENCE_TOO_LARGE:')) {
            return reply.status(413).send({ error: 'REACTIVATION_AUDIENCE_TOO_LARGE' });
          }
        }
        req.log.error({ err: error }, 'legacy reactivation migration failed');
        return reply.status(503).send({ error: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN' });
      }

      try {
        // Queueing is an at-least-once operation. The deterministic job id
        // makes a retry safe when the provider accepted the first enqueue
        // but the HTTP request failed before receiving its response.
        await queues.marketingCampaign.add(
          'send-campaign',
          { campaignId: migration.marketingCampaignId, restaurantId },
          { jobId: `marketing-campaign:${migration.marketingCampaignId}` },
        );
      } catch (error) {
        req.log.error({ err: error }, 'legacy reactivation queue enqueue failed');
        return reply.status(503).send({ error: 'MARKETING_QUEUE_ENQUEUE_UNKNOWN' });
      }

      return reply.send({
        ok: true,
        message: migration.replayed
          ? 'Envoi déjà préparé, reprise de la file en cours'
          : 'Campagne migrée, envoi en cours',
        campaignId: migration.marketingCampaignId,
        migrated: !migration.replayed,
        audienceCount: migration.audienceCount,
        droppedCustomerCount: migration.droppedCustomerCount,
      });
    },
  );

  // Ignorer une campaign PENDING
  app.post(
    '/dashboard/reactivation/:id/dismiss',
    { preHandler: requireReactivationWrite },
    async (req, reply) => {
      const restaurantId = req.restaurantId as string;
      const { id } = req.params as { id: string };

      const campaign = await db.reactivationCampaign.findFirst({
        where: { id, restaurantId },
      });

      if (!campaign) {
        return reply.status(404).send({ error: 'Campagne introuvable' });
      }

      if (campaign.status !== 'PENDING') {
        return reply.status(409).send({ error: 'Cette campagne a déjà été traitée' });
      }

      await db.reactivationCampaign.update({
        where: { id },
        data: { status: 'DISMISSED' },
      });

      return reply.send({ ok: true });
    },
  );
}
