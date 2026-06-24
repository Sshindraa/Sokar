/**
 * Canal A — Analytics worker.
 *
 * Dépile la queue `canal-a-analytics` (BullMQ) et incrémente les
 * compteurs Prometheus. Pas de DB, pas d'audit log : c'est purement
 * de l'analytics agrégée.
 *
 * Le détail par event reste dans les logs Pino du handler HTTP
 * (apps/api/src/modules/canal-a/canal-a.routes.ts) pour debug.
 *
 * Cf. spec canal-a-v1.1 §16.
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';
import {
  canalAEventsTotal,
  canalAReservationsConfirmedTotal,
} from '../../observability/metrics';

export type CanalAAnalyticsJobData = {
  event: string;
  restaurantId?: string;
  restaurantSlug?: string;
  city?: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  sentAt?: string;
  // Champs spécifiques par event
  date?: string;
  time?: string;
  partySize?: number;
  reservationId?: string;
};

const VALID_EVENTS = new Set([
  'restaurant_page_view',
  'restaurant_book_cta_clicked',
  'booking_page_view',
  'availability_requested',
  'reservation_hold_created',
  'reservation_hold_expired',
  'reservation_confirmed',
  'reservation_failed',
]);

function normalizeSource(source: string | undefined): string {
  if (!source) return 'unknown';
  const s = source.toLowerCase().slice(0, 32);
  if (s.length === 0) return 'unknown';
  return s;
}

export const canalAAnalyticsWorker = new Worker(
  'canal-a-analytics',
  async (job: Job<CanalAAnalyticsJobData>) => {
    const log = jobLogger(job);
    const data = job.data;

    if (!data.event || !VALID_EVENTS.has(data.event)) {
      log.warn({ event: data.event }, '[canal-a] unknown event type, dropping');
      return;
    }

    const source = normalizeSource(data.source);

    // Compteur générique : tout event compte
    canalAEventsTotal.inc({ event: data.event, source });

    // Compteur spécifique pour les confirmations (pour taux de conversion)
    if (data.event === 'reservation_confirmed') {
      canalAReservationsConfirmedTotal.inc({
        source,
        city: (data.city ?? 'unknown').toLowerCase().slice(0, 32),
      });
    }

    log.debug(
      { event: data.event, source, restaurantSlug: data.restaurantSlug },
      '[canal-a] event processed',
    );
  },
  { connection: redisQueue, concurrency: 10 },
);

setupWorkerListeners(canalAAnalyticsWorker);
