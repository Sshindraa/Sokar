/**
 * Sokar Connect — Helper d'émission d'événements analytics.
 *
 * Centralise l'envoi d'events vers la queue BullMQ `connect-analytics`.
 * Best-effort : si la queue est down, on log un warning et on ne throw pas.
 *
 * Cf. spec v1.1 §10 T9.
 */

import type { Queue } from 'bullmq';
import { logger } from '../../shared/logger/pino';
import type { ConnectAnalyticsJobData } from '../../shared/queue/workers/connect-analytics.worker';

export type EmitConnectEventInput = {
  event: string;
  restaurantId?: string;
  restaurantSlug?: string;
  city?: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  date?: string;
  time?: string;
  partySize?: number;
  reservationId?: string;
  bot?: string;
  path?: string;
};

/**
 * Émet un événement analytics vers la queue `connect-analytics`.
 * Ne throw jamais (best-effort). Retourne true si l'event a été queued.
 */
export async function emitConnectEvent(
  queue: Queue<ConnectAnalyticsJobData>,
  input: EmitConnectEventInput,
): Promise<boolean> {
  try {
    await queue.add(
      'connect-event',
      {
        event: input.event,
        restaurantId: input.restaurantId,
        restaurantSlug: input.restaurantSlug,
        city: input.city,
        source: input.source ?? 'web',
        utmSource: input.utmSource,
        utmMedium: input.utmMedium,
        utmCampaign: input.utmCampaign,
        date: input.date,
        time: input.time,
        partySize: input.partySize,
        reservationId: input.reservationId,
        bot: input.bot,
        path: input.path,
        sentAt: new Date().toISOString(),
      },
      {
        priority: input.event === 'reservation_confirmed' ? 1 : 5,
      },
    );
    return true;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, event: input.event },
      'connect queue add failed',
    );
    return false;
  }
}
