import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { setupWorkerListeners, jobLogger } from './helper';

/**
 * Worker pour la réactivation des VIPs dormants.
 *
 * Canal : toujours SMS (WhatsApp marketing coûte 5x plus cher + opt-in requis).
 *
 * Jobs :
 * 1. { kind: 'scan' } — Cron hebdo (lundi 10h). Pour chaque restaurant, scanne
 *    les VIPs avec lastSeenAt entre 90 et 180 jours, crée une campaign PENDING.
 * 2. { kind: 'send', campaignId } — legacy payload conservé pour drainer les
 *    jobs déjà présents. Il ne contacte plus le provider : la route dashboard
 *    migre d'abord vers MarketingCampaign, puis la file marketing gouvernée
 *    applique consentement, suppression, fréquence et désinscription.
 */

interface ReactivationJobData {
  kind: 'scan' | 'send';
  campaignId?: string;
}

const DORMANT_MIN_DAYS = 90;
const DORMANT_MAX_DAYS = 180;

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
      const automatedRestaurants = new Set(
        (
          (await db.marketingAutomation.findMany({
            where: { enabled: true, type: 'DORMANT' },
            select: { restaurantId: true },
          })) ?? []
        ).map((automation) => automation.restaurantId),
      );

      // Une seule query pour tous les VIPs dormants (évite un N+1 : un findMany par restaurant).
      const allDormantVips = await db.customer.findMany({
        where: {
          isVip: true,
          lastSeenAt: { gte: minDate, lte: maxDate },
          restaurant: { onboardingDone: true },
        },
        select: { id: true, restaurantId: true },
      });
      const vipsByRestaurant = new Map<string, string[]>();
      for (const v of allDormantVips) {
        const list = vipsByRestaurant.get(v.restaurantId);
        if (list) {
          list.push(v.id);
        } else {
          vipsByRestaurant.set(v.restaurantId, [v.id]);
        }
      }

      let campaignsCreated = 0;

      for (const restaurant of restaurants) {
        // Once the governed DORMANT automation is enabled, it owns dormant
        // customer selection. Keeping the legacy scan idle avoids creating a
        // second snapshot for the same restaurant during the transition.
        if (automatedRestaurants.has(restaurant.id)) continue;
        const dormantVips = vipsByRestaurant.get(restaurant.id) ?? [];

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
            customerIds: dormantVips,
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
        select: {
          id: true,
          status: true,
          marketingCampaignId: true,
        },
      });

      if (campaign.marketingCampaignId) {
        log.warn(
          { campaignId: campaign.id, marketingCampaignId: campaign.marketingCampaignId },
          'legacy reactivation job already migrated; governed campaign owns delivery',
        );
        return { migrated: true, marketingCampaignId: campaign.marketingCampaignId };
      }
      log.error(
        { campaignId: campaign.id, status: campaign.status },
        'legacy reactivation send blocked: migration required before provider access',
      );
      return { migrated: false, blocked: 'MIGRATION_REQUIRED' };
    }
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(reactivationWorker);
