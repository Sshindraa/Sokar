/**
 * @sokar/shared — JSON-LD types for Schema.org Restaurant.
 *
 * Source unique pour les types JSON-LD utilisés par Connect (frontend)
 * et l'API (jsonld.service.ts). Cf. spec v1.1 §8.
 *
 * Règles :
 * - acceptsReservations est un booléen (Schema.org spec)
 * - potentialAction (ReserveAction) uniquement si connectAgentic=true
 * - aggregateRating uniquement si sourcé Google Places (Phase 3)
 */

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
