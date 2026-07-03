/**
 * Sokar Connect — Tracking helpers.
 *
 * On tracke page_view et cta_clicked via des requêtes fetch asynchrones
 * vers l'API interne (apps/api). L'API pousse ces events dans la queue
 * BullMQ `connect-analytics` qui incrémente les compteurs prom-client
 * (cf. apps/api/src/shared/queue/workers/connect-analytics.worker.ts).
 *
 * Pas de PII : on hashe IP côté client (subresource integrity), pas de
 * cookie tracking, pas de third-party script.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

export type AnalyticsEvent =
  | {
      event: 'restaurant_page_view';
      restaurantId: string;
      restaurantSlug: string;
      city: string;
      source?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
    }
  | {
      event: 'restaurant_book_cta_clicked';
      restaurantId: string;
      restaurantSlug: string;
      source?: string;
    }
  | { event: 'booking_page_view'; restaurantId: string; restaurantSlug: string; source?: string }
  | { event: 'widget_page_view'; restaurantId: string; restaurantSlug: string; source?: string }
  | {
      event: 'availability_requested';
      restaurantId: string;
      restaurantSlug: string;
      date: string;
      partySize: number;
    }
  | {
      event: 'availability_slot_selected';
      restaurantId: string;
      restaurantSlug: string;
      date: string;
      time: string;
      partySize: number;
      source?: string;
    }
  | {
      event: 'reservation_hold_created';
      restaurantId: string;
      restaurantSlug: string;
      date: string;
      time: string;
      partySize: number;
      source?: string;
    }
  | {
      event: 'reservation_confirmed';
      restaurantId: string;
      restaurantSlug: string;
      reservationId: string;
      source?: string;
    }
  | {
      event: 'availability_preview_shown';
      restaurantId: string;
      restaurantSlug: string;
      date: string;
      partySize: number;
      availableCount: number;
    }
  | {
      event: 'availability_preview_clicked';
      restaurantId: string;
      restaurantSlug: string;
      date: string;
      time: string;
      partySize: number;
    };

/**
 * Envoie un événement analytics en fire-and-forget.
 * Ne throw pas d'erreur si l'API est down (l'event est best-effort).
 */
export function trackEvent(event: AnalyticsEvent): void {
  // On n'attend pas la réponse, on log les erreurs
  fetch(`${API_URL}/public/analytics/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...event, sentAt: new Date().toISOString() }),
    // Pas de cache, pas d'auth
    cache: 'no-store',
    keepalive: true,
  }).catch((err) => {
    // Pas de throw : l'event est best-effort
    if (typeof console !== 'undefined') {
      console.error('[connect] analytics event failed', err);
    }
  });
}

/**
 * Version async de trackEvent, utilisable dans les Server Components
 * avec `void trackEventAsync(...)` pour éviter les fuites de promesse
 * détectées par le linter Next.js.
 * Reste best-effort : n'importe pas le rendu si l'API est down.
 */
export async function trackEventAsync(event: AnalyticsEvent): Promise<void> {
  try {
    await fetch(`${API_URL}/public/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, sentAt: new Date().toISOString() }),
      cache: 'no-store',
    });
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error('[connect] analytics event async failed', err);
    }
  }
}

/** Helper spécifique : page view. */
export function trackPageView(args: {
  restaurantId: string;
  restaurantSlug: string;
  city: string;
  source?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
}): void {
  trackEvent({
    event: 'restaurant_page_view',
    ...args,
  });
}

/** Helper spécifique : CTA Réserver cliqué. */
export function trackBookCta(args: {
  restaurantId: string;
  restaurantSlug: string;
  source?: string;
}): void {
  trackEvent({
    event: 'restaurant_book_cta_clicked',
    ...args,
  });
}
