/**
 * Sokar Connect — JSON-LD helpers.
 *
 * Wrapper pour injecter le JSON-LD Restaurant dans le <head> des pages publiques.
 * Cf. spec connect-v1.1 §8.
 */

import type { RestaurantJsonLd } from './jsonld.types';

export type { RestaurantJsonLd };

/**
 * Server Component qui injecte le JSON-LD inline.
 * Next.js 14 le rend dans le <head> automatiquement.
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

/**
 * Re-export local du builder JSON-LD (apps/api/src/modules/connect/jsonld.service.ts).
 *
 * En P0, on duplique la fonction côté Next (Server Component) pour éviter
 * un couplage workspace build qui ralentirait l'itération. En P1, on
 * extraira dans `@sokar/shared` une fonction pure sans dépendance Prisma.
 *
 * Note : cette duplication est TEMPORAIRE. Elle sera supprimée quand
 * l'API publique (T2) sera l'unique source de JSON-LD (cf. spec v1.1 §6.1).
 */
export function buildPublicRestaurantJsonLd(input: {
  restaurant: {
    id: string;
    slug: string;
    name: string;
    description?: string;
    address: { line1: string; city: string; country: string; postalCode?: string };
    phone: string;
    cuisineTypes: string[];
    priceRange?: string;
    openingHours: Array<{ day: string; open: string; close: string }>;
    reservationUrl: string;
    images: { cover?: string; gallery: string[] };
    acceptsReservations: boolean;
    publishedAt: string;
    connectAgentic: boolean;
    lat?: number;
    lng?: number;
    aggregateRating?: {
      ratingValue: number;
      reviewCount: number;
      provider: 'google';
    };
  };
  attributesConfidence: unknown;
}): RestaurantJsonLd {
  const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';
  const r = input.restaurant;

  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${SITE_URL}/restaurant/${r.slug}`,
    name: r.name,
    url: `${SITE_URL}/restaurant/${r.slug}`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/restaurant/${r.slug}`,
    },
    telephone: r.phone,
    servesCuisine: r.cuisineTypes,
    acceptsReservations: true,
    bookingUrl: r.reservationUrl,
    address: {
      '@type': 'PostalAddress',
      streetAddress: r.address.line1,
      addressLocality: r.address.city,
      ...(r.address.postalCode ? { postalCode: r.address.postalCode } : {}),
      addressCountry: r.address.country,
    },
    openingHoursSpecification: r.openingHours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: [h.day.charAt(0).toUpperCase() + h.day.slice(1)],
      opens: h.open,
      closes: h.close,
    })),
    ...(r.description ? { description: r.description } : {}),
    ...(r.priceRange ? { priceRange: r.priceRange } : {}),
    ...(r.images.cover
      ? {
          image: [r.images.cover, ...r.images.gallery].filter(Boolean),
        }
      : {}),
    ...(r.connectAgentic
      ? {
          potentialAction: {
            '@type': 'ReserveAction',
            target: {
              '@type': 'EntryPoint',
              urlTemplate: `${SITE_URL}/restaurant/${r.slug}/book?partySize={partySize}&date={date}&time={time}`,
              inLanguage: 'fr-FR',
              actionPlatform: [
                'https://schema.org/DesktopWebPlatform',
                'https://schema.org/MobileWebPlatform',
              ],
            },
            result: {
              '@type': 'FoodEstablishmentReservation',
              name: 'Réservation de table',
            },
          },
        }
      : {}),
    ...(r.lat != null && r.lng != null
      ? {
          geo: {
            '@type': 'GeoCoordinates' as const,
            latitude: r.lat,
            longitude: r.lng,
          },
        }
      : {}),
    ...(r.aggregateRating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating' as const,
            ratingValue: r.aggregateRating.ratingValue,
            reviewCount: r.aggregateRating.reviewCount,
            author: { '@type': 'Organization' as const, name: 'Google' },
          },
        }
      : {}),
  };
}
