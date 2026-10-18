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
 * Server Component qui injecte les données JSON-LD.
 * Ces scripts sont des blocs de données inertes, pas du JavaScript exécutable :
 * ils n'ont pas besoin du nonce CSP par requête.
 */
export function ReservationJsonLd({ jsonLd }: { jsonLd: RestaurantJsonLd }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
