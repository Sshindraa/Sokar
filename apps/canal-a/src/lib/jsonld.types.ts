/**
 * Canal A — types JSON-LD (copie locale des types de l'API).
 * Source unique à terme : packages/shared (TBD P1).
 */
export type RestaurantJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'Restaurant';
  '@id': string;
  name: string;
  description?: string;
  url: string;
  telephone: string;
  servesCuisine: string[];
  priceRange?: string;
  image?: string[];
  acceptsReservations: string;
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
};
