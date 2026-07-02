/**
 * Sokar Connect — JSON-LD Service.
 *
 * Génère le Schema.org Restaurant JSON-LD pour /r/[slug].
 *
 * Règles strictes (cf. spec v1.1 §8) :
 * - `aggregateRating` uniquement si sourcé Google Places (Phase 3)
 * - Pas de claims non sourcés : `attributeConfidence` gate chaque champ
 * - `acceptsReservations` = URL /book (pas un bool)
 * - `potentialAction` (ReserveAction) UNIQUEMENT si connectAgentic=true
 * - HTML visible et JSON-LD utilisent la même source de données
 *   (toPublicDto déjà appliqué par le service principal)
 *
 * Cf. https://schema.org/Restaurant, https://schema.org/ReserveAction
 */

import {
  computeAttributeConfidence,
  type ConfidenceSource,
} from '../agentic-reservations/core/confidence.service';
import type { OpeningHoursSpec, PublicRestaurantDto } from './connect.types';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

// Seuils min de confidence par attribut (cf. spec v1.1 §5.5)
const CONFIDENCE_THRESHOLDS = {
  cuisineType: 0.5,
  priceRange: 0.7,
  openingHours: 0.9,
  ambiance: 0.5,
  dietary: 0.7,
  noiseLevel: 0.5,
} as const;

export type BuildJsonLdInput = {
  restaurant: PublicRestaurantDto;
  /** Restaurant.attributesConfidence JSON brut depuis Prisma */
  attributesConfidence: Record<
    string,
    Array<{ source: ConfidenceSource; verifiedAt: string | null }>
  > | null;
};

export type RestaurantJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'Restaurant';
  '@id': string;
  name: string;
  description?: string;
  url: string;
  mainEntityOfPage?: {
    '@type': 'WebPage';
    '@id': string;
  };
  telephone: string;
  servesCuisine: string[];
  priceRange?: string;
  image?: string[];
  acceptsReservations: string;
  bookingUrl?: string;
  address: {
    '@type': 'PostalAddress';
    streetAddress: string;
    addressLocality: string;
    postalCode?: string;
    addressCountry: string;
  };
  geo?: {
    '@type': 'GeoCoordinates';
    latitude: number;
    longitude: number;
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
  aggregateRating?: {
    '@type': 'AggregateRating';
    ratingValue: number;
    reviewCount: number;
    author?: { '@type': 'Organization'; name: string };
  };
};

/**
 * Construit le JSON-LD d'un restaurant pour /r/[slug].
 * Ne JAMAIS retourner de l'invention : si une donnée n'a pas la confidence
 * requise, on l'omet.
 */
export function buildPublicRestaurantJsonLd(input: BuildJsonLdInput): RestaurantJsonLd {
  const { restaurant, attributesConfidence } = input;
  const conf = attributesConfidence ?? {};
  const now = new Date();

  const jsonLd: RestaurantJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${SITE_URL}/restaurant/${restaurant.slug}`,
    name: restaurant.name,
    url: `${SITE_URL}/restaurant/${restaurant.slug}`,
    // mainEntityOfPage : signal fort que cette page EST le restaurant,
    // pas un article qui en parle. Aide les crawlers IA à comprendre le type.
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/restaurant/${restaurant.slug}`,
    },
    telephone: restaurant.phone,
    servesCuisine: filterByConfidence(
      restaurant.cuisineTypes,
      conf.cuisineType,
      CONFIDENCE_THRESHOLDS.cuisineType,
      now,
    ),
    acceptsReservations: restaurant.reservationUrl,
    // bookingUrl explicite pour les crawlers IA qui ne parsent pas ReserveAction.
    // Double signal : acceptsReservations (bool/URL) + bookingUrl (URL directe).
    bookingUrl: restaurant.reservationUrl,
    address: {
      '@type': 'PostalAddress',
      streetAddress: restaurant.address.line1,
      addressLocality: restaurant.address.city,
      ...(restaurant.address.postalCode ? { postalCode: restaurant.address.postalCode } : {}),
      addressCountry: restaurant.address.country,
    },
    openingHoursSpecification: buildOpeningHoursSpec(
      restaurant.openingHours,
      conf.openingHours,
      CONFIDENCE_THRESHOLDS.openingHours,
      now,
    ),
  };

  // Description : on inclut si présente (pas de confidence gate, c'est de l'éditorial)
  if (restaurant.description) {
    jsonLd.description = restaurant.description;
  }

  // PriceRange : confidence ≥ 0.7
  if (restaurant.priceRange) {
    const priceConf = computeAttributeConfidence(conf.priceRange ?? [], now);
    if (priceConf.final >= CONFIDENCE_THRESHOLDS.priceRange) {
      jsonLd.priceRange = restaurant.priceRange;
    }
  }

  // Image : on inclut cover + gallery si présents
  const images: string[] = [];
  if (restaurant.images.cover) images.push(restaurant.images.cover);
  if (restaurant.images.gallery.length > 0) images.push(...restaurant.images.gallery);
  if (images.length > 0) jsonLd.image = images;

  // potentialAction (ReserveAction) : UNIQUEMENT si connectAgentic=true
  if (restaurant.connectAgentic) {
    jsonLd.potentialAction = {
      '@type': 'ReserveAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/restaurant/${restaurant.slug}/book?partySize={partySize}&date={date}&time={time}`,
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

  // GeoCoordinates : inclus uniquement si les deux coordonnées sont présentes
  if (restaurant.lat != null && restaurant.lng != null) {
    jsonLd.geo = {
      '@type': 'GeoCoordinates',
      latitude: restaurant.lat,
      longitude: restaurant.lng,
    };
  }

  // aggregateRating : uniquement si sourcé Google Places (Phase 3).
  // Respect CGU Google : attribution obligatoire (author.name = "Google").
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

/**
 * Filtre un tableau selon la confidence (enlève les items qui n'ont pas
 * assez de sources ou dont la source max est sous le seuil).
 */
function filterByConfidence<T>(
  items: T[],
  confSources: Array<{ source: ConfidenceSource; verifiedAt: string | null }> | undefined,
  threshold: number,
  now: Date,
): T[] {
  if (!items || items.length === 0) return [];
  if (!confSources || confSources.length === 0) {
    // Pas de source tracked : on n'inclut pas (anti-hallucination)
    return [];
  }
  const conf = computeAttributeConfidence(confSources, now);
  if (conf.final < threshold) {
    return [];
  }
  return items;
}

/** Construit openingHoursSpecification[] schema.org */
function buildOpeningHoursSpec(
  hours: OpeningHoursSpec,
  confSources: Array<{ source: ConfidenceSource; verifiedAt: string | null }> | undefined,
  threshold: number,
  now: Date,
): RestaurantJsonLd['openingHoursSpecification'] {
  if (!hours || hours.length === 0) return [];

  // Si openingHours n'a pas de source tracked avec confidence suffisante, on omet tout
  if (confSources && confSources.length > 0) {
    const conf = computeAttributeConfidence(confSources, now);
    if (conf.final < threshold) {
      return [];
    }
  } else if (threshold >= 0.9) {
    // openingHours threshold = 0.9 et pas de source = pas de claim
    return [];
  }

  return hours.map((h) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: [capitalize(h.day)],
    opens: h.open,
    closes: h.close,
  }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
