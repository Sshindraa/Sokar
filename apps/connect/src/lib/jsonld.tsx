/**
 * Sokar Connect — JSON-LD helpers.
 *
 * Wrapper pour injecter le JSON-LD Restaurant dans le <head> des pages publiques.
 * Cf. spec connect-v1.1 §8.
 */

import { buildPublicRestaurantJsonLd, type RestaurantJsonLd } from '@sokar/shared';

export type { RestaurantJsonLd };
export { buildPublicRestaurantJsonLd };

/**
 * Server Component qui injecte le JSON-LD inline.
 * Next.js 14 le rend dans le <head> automatiquement.
 *
 * Le nonce est requis par la CSP (audit sécurité Phase 2) — sans nonce,
 * le script inline est bloqué par le navigateur. Le nonce est généré dans
 * le middleware et lu via headers() dans la page.
 */
export function ReservationJsonLd({ jsonLd, nonce }: { jsonLd: RestaurantJsonLd; nonce?: string }) {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
