import { FastifyInstance } from 'fastify';
import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { requireOrg } from '../../plugins/clerk';

/**
 * Routes pour la réactivation des VIPs dormants (semi-automatique).
 *
 * Le cron hebdo crée des campaigns PENDING. Le gérant voit la liste
 * sur le dashboard et valide l'envoi des SMS.
 */

export async function reactivationRoutes(app: FastifyInstance) {
  // Liste les campaigns PENDING + SENT (historique)
  app.get('/dashboard/reactivation', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;

    const campaigns = await db.reactivationCampaign.findMany({
      where: { restaurantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    // Pour les campaigns PENDING, charger les détails des VIPs
    // Une seule query pour tous les customers (évite un N+1 : un findMany par campaign).
    const allCustomerIds = campaigns.flatMap((c) => c.customerIds);
    const allCustomers =
      allCustomerIds.length > 0
        ? await db.customer.findMany({
            where: { id: { in: allCustomerIds } },
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
      if (campaign.customerIds.length === 0) return { ...campaign, customers: [] };

      const customers = campaign.customerIds
        .map((id) => customerMap.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c);

      return {
        id: campaign.id,
        status: campaign.status,
        sentCount: campaign.sentCount,
        sentAt: campaign.sentAt,
        createdAt: campaign.createdAt,
        customerCount: campaign.customerIds.length,
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
  app.post('/dashboard/reactivation/:id/send', { preHandler: requireOrg() }, async (req, reply) => {
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

    // Enqueue le job d'envoi
    await queues.reactivation.add('send-campaign', {
      kind: 'send',
      campaignId: campaign.id,
    });

    return reply.send({ ok: true, message: 'Envoi en cours' });
  });

  // Ignorer une campaign PENDING
  app.post(
    '/dashboard/reactivation/:id/dismiss',
    { preHandler: requireOrg() },
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
