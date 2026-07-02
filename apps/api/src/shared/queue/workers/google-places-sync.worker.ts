/**
 * Sokar Connect — Google Places rating sync worker.
 *
 * Dépile la queue `google-places-sync` : pour chaque restaurant avec un
 * googlePlaceId, appelle Google Places Details API et met à jour les champs
 * googleRating, googleReviewCount, googleRatingSyncedAt.
 *
 * Invalide le cache Connect du restaurant après sync (pour que la nouvelle
 * note remonte sur la page publique au prochain revalidate).
 *
 * Planifié via un cron BullMQ (repeat pattern) — 1x/jour par restaurant.
 * Cf. spec Phase 3 (aggregateRating).
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { db } from '../../db/client';
import { fetchGooglePlacesRating } from '../../../modules/connect/google-places.service';
import { ConnectService } from '../../../modules/connect/connect.service';
import { redisCache } from '../../redis/client';
import { queues } from '../queues';
import { logger } from '../../logger/pino';

export type GooglePlacesSyncJobData = {
  restaurantId: string;
};

const connectService = new ConnectService(db, redisCache);

export const googlePlacesSyncWorker = new Worker(
  'google-places-sync',
  async (job: Job<GooglePlacesSyncJobData>) => {
    const log = jobLogger(job);
    const { restaurantId } = job.data;

    const restaurant = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: {
        id: true,
        slug: true,
        googlePlaceId: true,
        googleRatingSyncedAt: true,
      },
    });

    if (!restaurant) {
      log.warn({ restaurantId }, '[google-places-sync] restaurant not found, skipping');
      return;
    }

    if (!restaurant.googlePlaceId) {
      log.debug({ restaurantId }, '[google-places-sync] no googlePlaceId, skipping');
      return;
    }

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    const result = await fetchGooglePlacesRating(restaurant.googlePlaceId, apiKey);

    if (!result) {
      log.warn(
        { restaurantId, placeId: restaurant.googlePlaceId },
        '[google-places-sync] no rating returned from Google Places',
      );
      return;
    }

    await db.restaurant.update({
      where: { id: restaurantId },
      data: {
        googleRating: result.rating,
        googleReviewCount: result.reviewCount,
        googleRatingSyncedAt: new Date(),
      },
    });

    // Invalide le cache Connect pour que la nouvelle note remonte
    if (restaurant.slug) {
      await connectService.invalidateSlugCache(restaurant.slug);
    }

    log.info(
      { restaurantId, rating: result.rating, reviewCount: result.reviewCount },
      '[google-places-sync] rating updated from Google Places',
    );
  },
  { connection: redisQueue, concurrency: 5 },
);

setupWorkerListeners(googlePlacesSyncWorker);

/**
 * Planifie la sync quotidienne pour tous les restaurants avec un googlePlaceId.
 * À appeler au démarrage de l'API (ou via un cron externe).
 */
export async function scheduleGooglePlacesSync(): Promise<void> {
  const restaurants = await db.restaurant.findMany({
    where: { googlePlaceId: { not: null } },
    select: { id: true },
  });

  for (const r of restaurants) {
    await queues.googlePlacesSync.add('sync-rating', { restaurantId: r.id });
  }

  logger.info(
    { count: restaurants.length },
    '[google-places-sync] scheduled sync for restaurants with googlePlaceId',
  );
}
