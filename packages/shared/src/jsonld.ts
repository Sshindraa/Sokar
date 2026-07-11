/**
 * @sokar/shared — JSON-LD types and builder for Schema.org Restaurant.
 *
 * Source unique pour le JSON-LD SEO (Sokar Connect + API).
 * Cf. spec v1.1 §8.
 *
 * Règles :
 * - acceptsReservations est la reservationUrl (URL /book) et pas un simple bool.
 * - potentialAction (ReserveAction) uniquement si connectAgentic=true.
 * - aggregateRating uniquement si sourcé Google Places (Phase 3).
 * - Les champs sensibles (cuisineType, priceRange, openingHours) sont filtrés
 *   par confidence si un attributConfidence est fourni. Si le paramètre est omis
 *   (undefined), on considère la donnée comme déjà validée et on ne filtre pas.
 */

import {
  type AttributeInput,
  type ConfidenceSource,
  computeAttributeConfidence,
} from './confidence';

export type RestaurantJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'Restaurant';
  '@id': string;
  name: string;
  description?: string;
  url: string;
  // mainEntityOfPage : signal que cette page EST le restaurant (pas un article)
  mainEntityOfPage?: {
    '@type': 'WebPage';
    '@id': string;
  };
  telephone: string;
  servesCuisine: string[];
  priceRange?: string;
  image?: string[];
  acceptsReservations: boolean | string;
  // bookingUrl : URL directe de réservation (complémentaire de acceptsReservations)
  bookingUrl?: string;
  address: {
    '@type': 'PostalAddress';
    streetAddress: string;
    addressLocality: string;
    postalCode?: string;
    addressCountry: string;
  };
  openingHoursSpecification: Array<{
    '@type': 'OpeningHoursSpecification';
    dayOfWeek: string[];
    opens: string;
    closes: string;
  }>;
  potentialAction?: {
    '@type': 'ReserveAction';
    target: {
      '@type': 'EntryPoint';
      urlTemplate: string;
      inLanguage: string;
      actionPlatform: string[];
    };
    result: {
      '@type': 'FoodEstablishmentReservation';
      name: string;
    };
  };
  geo?: {
    '@type': 'GeoCoordinates';
    latitude: number;
    longitude: number;
  };
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: number;
    reviewCount: number;
    author?: { '@type': 'Organization'; name: string };
  };
};

export type AttributesConfidence = Record<string, AttributeInput[] | undefined>;

export type BuildPublicRestaurantJsonLdInput = {
  siteUrl: string;
  restaurant: {
    id: string;
    slug: string;
    name: string;
    description?: string;
    address: {
      line1: string;
      city: string;
      country: string;
      postalCode?: string;
    };
    phone: string;
    cuisineTypes: string[];
    priceRange?: string;
    openingHours: Array<{ day: string; open: string; close: string }>;
    reservationUrl: string;
    images: { cover?: string; gallery: string[] };
    connectAgentic: boolean;
    lat?: number;
    lng?: number;
    aggregateRating?: {
      ratingValue: number;
      reviewCount: number;
      provider: 'google';
    };
  };
  attributesConfidence?: AttributesConfidence | null;
};

// Seuils min de confidence par attribut (cf. spec v1.1 §5.5)
const CONFIDENCE_THRESHOLDS = {
  cuisineType: 0.5,
  priceRange: 0.7,
  openingHours: 0.9,
  ambiance: 0.5,
  dietary: 0.7,
  noiseLevel: 0.5,
} as const;

/**
 * Construit le JSON-LD d'un restaurant pour /r/[slug].
 * Si attributesConfidence est fourni, les champs concernés sont filtrés par
 * confidence. Si le paramètre est omis, les données sont prises telles quelles.
 */
export function buildPublicRestaurantJsonLd(
  input: BuildPublicRestaurantJsonLdInput,
): RestaurantJsonLd {
  const { siteUrl, restaurant, attributesConfidence } = input;
  const conf = attributesConfidence ?? {};
  const now = new Date();
  const gate = attributesConfidence !== undefined;

  const jsonLd: RestaurantJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${siteUrl}/restaurant/${restaurant.slug}`,
    name: restaurant.name,
    url: `${siteUrl}/restaurant/${restaurant.slug}`,
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${siteUrl}/restaurant/${restaurant.slug}`,
    },
    telephone: restaurant.phone,
    servesCuisine: gate
      ? filterByConfidence(
          restaurant.cuisineTypes,
          conf.cuisineType,
          CONFIDENCE_THRESHOLDS.cuisineType,
          now,
        )
      : restaurant.cuisineTypes,
    acceptsReservations: restaurant.reservationUrl,
    bookingUrl: restaurant.reservationUrl,
    address: {
      '@type': 'PostalAddress',
      streetAddress: restaurant.address.line1,
      addressLocality: restaurant.address.city,
      ...(restaurant.address.postalCode ? { postalCode: restaurant.address.postalCode } : {}),
      addressCountry: restaurant.address.country,
    },
    openingHoursSpecification: gate
      ? buildOpeningHoursSpec(
          restaurant.openingHours,
          conf.openingHours,
          CONFIDENCE_THRESHOLDS.openingHours,
          now,
        )
      : restaurant.openingHours.map((h) => ({
          '@type': 'OpeningHoursSpecification' as const,
          dayOfWeek: [capitalize(h.day)],
          opens: h.open,
          closes: h.close,
        })),
  };

  if (restaurant.description) {
    jsonLd.description = restaurant.description;
  }

  if (restaurant.priceRange) {
    if (gate) {
      const priceConf = computeAttributeConfidence(conf.priceRange ?? [], now);
      if (priceConf.final >= CONFIDENCE_THRESHOLDS.priceRange) {
        jsonLd.priceRange = restaurant.priceRange;
      }
    } else {
      jsonLd.priceRange = restaurant.priceRange;
    }
  }

  const images: string[] = [];
  if (restaurant.images.cover) images.push(restaurant.images.cover);
  if (restaurant.images.gallery.length > 0) images.push(...restaurant.images.gallery);
  if (images.length > 0) jsonLd.image = images;

  if (restaurant.connectAgentic) {
    jsonLd.potentialAction = {
      '@type': 'ReserveAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${restaurant.reservationUrl}?partySize={partySize}&date={date}&time={time}`,
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
    };
  }

  if (restaurant.lat != null && restaurant.lng != null) {
    jsonLd.geo = {
      '@type': 'GeoCoordinates',
      latitude: restaurant.lat,
      longitude: restaurant.lng,
    };
  }

  if (restaurant.aggregateRating) {
    jsonLd.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: restaurant.aggregateRating.ratingValue,
      reviewCount: restaurant.aggregateRating.reviewCount,
      author: { '@type': 'Organization', name: 'Google' },
    };
  }

  return jsonLd;
}

function filterByConfidence<T>(
  items: T[],
  confSources: AttributeInput[] | undefined,
  threshold: number,
  now: Date,
): T[] {
  if (!items || items.length === 0) return [];
  if (!confSources || confSources.length === 0) {
    return [];
  }
  const c = computeAttributeConfidence(confSources, now);
  if (c.final < threshold) {
    return [];
  }
  return items;
}

function buildOpeningHoursSpec(
  hours: BuildPublicRestaurantJsonLdInput['restaurant']['openingHours'],
  confSources: AttributeInput[] | undefined,
  threshold: number,
  now: Date,
): RestaurantJsonLd['openingHoursSpecification'] {
  if (!hours || hours.length === 0) return [];

  if (confSources && confSources.length > 0) {
    const c = computeAttributeConfidence(confSources, now);
    if (c.final < threshold) {
      return [];
    }
  } else if (threshold >= 0.9) {
    return [];
  }

  return hours.map((h) => ({
    '@type': 'OpeningHoursSpecification' as const,
    dayOfWeek: [capitalize(h.day)],
    opens: h.open,
    closes: h.close,
  }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
