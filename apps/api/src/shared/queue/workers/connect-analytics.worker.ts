/**
 * Sokar Connect — Analytics worker.
 *
 * Dépile la queue `connect-analytics` (BullMQ) et incrémente les
 * compteurs Prometheus. Pas de DB, pas d'audit log : c'est purement
 * de l'analytics agrégée.
 *
 * Le détail par event reste dans les logs Pino du handler HTTP
 * (apps/api/src/modules/connect/connect.routes.ts) pour debug.
 *
 * Cf. spec connect-v1.1 §16.
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';
import {
  connectEventsTotal,
  connectReservationsConfirmedTotal,
  connectIaBotHitsTotal,
} from '../../observability/metrics';

export type ConnectAnalyticsJobData = {
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
  // Champs spécifiques ia_bot_hit
  bot?: string;
  path?: string;
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
  'ia_bot_hit',
]);

/**
 * Classe un path en catégorie bornée pour le label path_class (anti-cardinalité).
 * Évite d'avoir un label par slug/URL.
 */
function classifyBotPath(path: string | undefined): string {
  if (!path) return 'other';
  if (path.startsWith('/restaurant/')) return 'restaurant';
  if (path === '/llms.txt') return 'llms.txt';
  if (path === '/sitemap.xml') return 'sitemap';
  if (path === '/robots.txt') return 'robots';
  if (path.startsWith('/.well-known/')) return 'well-known';
  return 'other';
}

function normalizeSource(source: string | undefined): string {
  if (!source) return 'unknown';
  const s = source.toLowerCase().slice(0, 32);
  if (s.length === 0) return 'unknown';
  return s;
}

export const connectAnalyticsWorker = new Worker(
  'connect-analytics',
  async (job: Job<ConnectAnalyticsJobData>) => {
    const log = jobLogger(job);
    const data = job.data;

    if (!data.event || !VALID_EVENTS.has(data.event)) {
      log.warn({ event: data.event }, '[connect] unknown event type, dropping');
      return;
    }

    const source = normalizeSource(data.source);

    // Compteur générique : tout event compte
    connectEventsTotal.inc({ event: data.event, source });

    // Compteur spécifique pour les hits bots IA (crawl web)
    if (data.event === 'ia_bot_hit') {
      connectIaBotHitsTotal.inc({
        bot: (data.bot ?? 'unknown').slice(0, 32),
        path_class: classifyBotPath(data.path),
      });
    }

    // Compteur spécifique pour les confirmations (pour taux de conversion)
    if (data.event === 'reservation_confirmed') {
      connectReservationsConfirmedTotal.inc({
        source,
        city: (data.city ?? 'unknown').toLowerCase().slice(0, 32),
      });
    }

    log.debug(
      { event: data.event, source, restaurantSlug: data.restaurantSlug },
      '[connect] event processed',
    );
  },
  { connection: redisQueue, concurrency: 10 },
);

setupWorkerListeners(connectAnalyticsWorker);
