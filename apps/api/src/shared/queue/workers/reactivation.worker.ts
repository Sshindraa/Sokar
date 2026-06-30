import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendSms } from '../../telnyx/client';
import { setupWorkerListeners, jobLogger } from './helper';

/**
 * Worker pour la réactivation des VIPs dormants.
 *
 * Jobs :
 * 1. { kind: 'scan' } — Cron hebdo (lundi 10h). Pour chaque restaurant, scanne
 *    les VIPs avec lastSeenAt entre 90 et 180 jours, crée une campaign PENDING.
 * 2. { kind: 'send', campaignId } — Envoyé quand le gérant valide sur le dashboard.
 *    Envoie un SMS personnalisé à chaque VIP de la campaign.
 */

interface ReactivationJobData {
  kind: 'scan' | 'send';
  campaignId?: string;
}

const DORMANT_MIN_DAYS = 90;
const DORMANT_MAX_DAYS = 180;

function formatReactivationSms(
  restaurantName: string,
  customerName: string,
  restaurantPhone: string,
): string {
  const firstName = customerName.split(' ')[0] || customerName;
  return `Bonjour ${firstName}, cela fait un moment qu'on ne vous a pas vu chez ${restaurantName}. On serait ravis de vous revoir ! Réservez au ${restaurantPhone}.`;
}

export const reactivationWorker = new Worker(
  'reactivation',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as ReactivationJobData;

    if (data.kind === 'scan') {
      const now = new Date();
      const minDate = new Date(now);
      minDate.setDate(minDate.getDate() - DORMANT_MAX_DAYS);
      const maxDate = new Date(now);
      maxDate.setDate(maxDate.getDate() - DORMANT_MIN_DAYS);

      const restaurants = await db.restaurant.findMany({
        select: { id: true },
        where: { onboardingDone: true },
      });

      let campaignsCreated = 0;

      for (const restaurant of restaurants) {
        const dormantVips = await db.customer.findMany({
          where: {
            restaurantId: restaurant.id,
            isVip: true,
            lastSeenAt: { gte: minDate, lte: maxDate },
          },
          select: { id: true },
        });

        if (dormantVips.length === 0) continue;

        // Éviter de créer une campaign si une PENDING existe déjà
        const existing = await db.reactivationCampaign.findFirst({
          where: {
            restaurantId: restaurant.id,
            status: 'PENDING',
          },
        });
        if (existing) continue;

        await db.reactivationCampaign.create({
          data: {
            restaurantId: restaurant.id,
            customerIds: dormantVips.map((c) => c.id),
          },
        });
        campaignsCreated++;
        log.info(
          { restaurantId: restaurant.id, vipCount: dormantVips.length },
          'reactivation campaign created',
        );
      }

      log.info({ campaignsCreated }, 'reactivation scan complete');
      return { campaignsCreated };
    }

    if (data.kind === 'send' && data.campaignId) {
      const campaign = await db.reactivationCampaign.findUniqueOrThrow({
        where: { id: data.campaignId },
        include: { restaurant: { select: { name: true, phoneNumber: true } } },
      });

      if (campaign.status !== 'PENDING') {
        log.warn(
          { campaignId: campaign.id, status: campaign.status },
          'campaign not PENDING, skipping',
        );
        return;
      }

      const customers = await db.customer.findMany({
        where: { id: { in: campaign.customerIds } },
        select: { id: true, name: true, phone: true },
      });

      let sent = 0;
      for (const customer of customers) {
        if (!customer.phone) continue;
        try {
          const sms = formatReactivationSms(
            campaign.restaurant.name,
            customer.name || 'cher client',
            campaign.restaurant.phoneNumber,
          );
          await sendSms(customer.phone, sms);
          sent++;
        } catch (err: any) {
          log.error(
            { err: err.message, customerId: customer.id },
            'failed to send reactivation SMS',
          );
        }
      }

      await db.reactivationCampaign.update({
        where: { id: campaign.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          sentCount: sent,
        },
      });

      log.info(
        { campaignId: campaign.id, sent, total: customers.length },
        'reactivation campaign sent',
      );
      return { sent, total: customers.length };
    }
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(reactivationWorker);
