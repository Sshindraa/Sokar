/**
 * Tests unitaires pour les helpers JSON-LD (buildPublicRestaurantJsonLd).
 */

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { buildPublicRestaurantJsonLd, ReservationJsonLd } from '@/lib/jsonld';
import type { RestaurantJsonLd } from '@/lib/jsonld.types';

const fullRestaurant: {
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
  aggregateRating?: { ratingValue: number; reviewCount: number; provider: 'google' };
} = {
  id: 'rest-1',
  slug: 'chez-sokar',
  name: 'Chez Sokar',
  description: 'Cuisine française moderne',
  address: { line1: '12 rue de la Paix', city: 'Paris', country: 'FR', postalCode: '75002' },
  phone: '+33123456789',
  cuisineTypes: ['Française', 'Moderne'],
  priceRange: '€€',
  openingHours: [
    { day: 'monday', open: '12:00', close: '22:00' },
    { day: 'tuesday', open: '12:00', close: '22:00' },
  ],
  reservationUrl: 'https://sokar.tech/book/chez-sokar',
  images: { cover: 'https://cdn.sokar.tech/cover.jpg', gallery: ['https://cdn.sokar.tech/1.jpg'] },
  acceptsReservations: true,
  publishedAt: '2024-01-01T00:00:00Z',
  connectAgentic: true,
  lat: 48.8566,
  lng: 2.3522,
  aggregateRating: { ratingValue: 4.5, reviewCount: 120, provider: 'google' },
};

function buildInput(overrides: Partial<typeof fullRestaurant> = {}) {
  return {
    siteUrl: process.env.SITE_URL ?? 'https://sokar.tech',
    restaurant: { ...fullRestaurant, ...overrides },
  };
}

describe('buildPublicRestaurantJsonLd', () => {
  it('produces a Restaurant type with @context schema.org', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json['@context']).toBe('https://schema.org');
    expect(json['@type']).toBe('Restaurant');
  });

  it('includes name, telephone, and url', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.name).toBe('Chez Sokar');
    expect(json.telephone).toBe('+33123456789');
    expect(json.url).toContain('/restaurant/chez-sokar');
  });

  it('includes a PostalAddress with street, city, postalCode, country', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.address['@type']).toBe('PostalAddress');
    expect(json.address.streetAddress).toBe('12 rue de la Paix');
    expect(json.address.addressLocality).toBe('Paris');
    expect(json.address.postalCode).toBe('75002');
    expect(json.address.addressCountry).toBe('FR');
  });

  it('omits postalCode when not provided', () => {
    const json = buildPublicRestaurantJsonLd(
      buildInput({
        address: { line1: '1 rue Test', city: 'Lyon', country: 'FR', postalCode: undefined },
      }),
    );
    expect(json.address.postalCode).toBeUndefined();
  });

  it('includes openingHoursSpecification with capitalized day names', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.openingHoursSpecification).toHaveLength(2);
    expect(json.openingHoursSpecification[0].dayOfWeek).toEqual(['Monday']);
    expect(json.openingHoursSpecification[0].opens).toBe('12:00');
    expect(json.openingHoursSpecification[0].closes).toBe('22:00');
  });

  it('includes servesCuisine and acceptsReservations', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.servesCuisine).toEqual(['Française', 'Moderne']);
    expect(json.acceptsReservations).toBe(fullRestaurant.reservationUrl);
  });

  it('includes bookingUrl from reservationUrl', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.bookingUrl).toBe(fullRestaurant.reservationUrl);
  });

  it('includes image array with cover + gallery when cover present', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.image).toEqual([
      'https://cdn.sokar.tech/cover.jpg',
      'https://cdn.sokar.tech/1.jpg',
    ]);
  });

  it('omits image when no cover', () => {
    const json = buildPublicRestaurantJsonLd(
      buildInput({ images: { cover: undefined, gallery: [] } }),
    );
    expect(json.image).toBeUndefined();
  });

  it('includes potentialAction ReserveAction when connectAgentic', () => {
    const json = buildPublicRestaurantJsonLd(buildInput({ connectAgentic: true }));
    expect(json.potentialAction?.['@type']).toBe('ReserveAction');
    expect(json.potentialAction?.target.urlTemplate).toContain('/book/chez-sokar');
  });

  it('omits potentialAction when connectAgentic is false', () => {
    const json = buildPublicRestaurantJsonLd(buildInput({ connectAgentic: false }));
    expect(json.potentialAction).toBeUndefined();
  });

  it('includes geo coordinates when lat and lng present', () => {
    const json = buildPublicRestaurantJsonLd(buildInput({ lat: 48.8566, lng: 2.3522 }));
    expect(json.geo?.['@type']).toBe('GeoCoordinates');
    expect(json.geo?.latitude).toBe(48.8566);
    expect(json.geo?.longitude).toBe(2.3522);
  });

  it('omits geo when lat or lng missing', () => {
    const json = buildPublicRestaurantJsonLd(buildInput({ lat: undefined, lng: 2.3522 }));
    expect(json.geo).toBeUndefined();
  });

  it('includes aggregateRating when present', () => {
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.aggregateRating?.['@type']).toBe('AggregateRating');
    expect(json.aggregateRating?.ratingValue).toBe(4.5);
    expect(json.aggregateRating?.reviewCount).toBe(120);
  });

  it('omits aggregateRating when not present', () => {
    const json = buildPublicRestaurantJsonLd(buildInput({ aggregateRating: undefined }));
    expect(json.aggregateRating).toBeUndefined();
  });

  it('omits description and priceRange when not provided', () => {
    const json = buildPublicRestaurantJsonLd(
      buildInput({ description: undefined, priceRange: undefined }),
    );
    expect(json.description).toBeUndefined();
    expect(json.priceRange).toBeUndefined();
  });

  it('uses SITE_URL env var when set', () => {
    const original = process.env.SITE_URL;
    process.env.SITE_URL = 'https://custom.example.com';
    const json = buildPublicRestaurantJsonLd(buildInput());
    expect(json.url).toBe('https://custom.example.com/restaurant/chez-sokar');
    process.env.SITE_URL = original;
  });
});

// Helper to build a minimal valid RestaurantJsonLd for component tests
function makeJsonLd(overrides: Partial<RestaurantJsonLd> = {}): RestaurantJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': 'https://sokar.tech/restaurant/chez-sokar',
    name: 'Chez Sokar',
    url: 'https://sokar.tech/restaurant/chez-sokar',
    telephone: '+33123456789',
    servesCuisine: ['Française'],
    acceptsReservations: true,
    address: {
      '@type': 'PostalAddress',
      streetAddress: '12 rue de la Paix',
      addressLocality: 'Paris',
      addressCountry: 'FR',
    },
    openingHoursSpecification: [],
    ...overrides,
  };
}

describe('ReservationJsonLd component', () => {
  it('renders a script tag with application/ld+json type', () => {
    const { container } = render(<ReservationJsonLd jsonLd={makeJsonLd()} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
  });

  it('injects the JSON-LD content via dangerouslySetInnerHTML', () => {
    const { container } = render(<ReservationJsonLd jsonLd={makeJsonLd({ name: 'Chez Sokar' })} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script?.textContent).toContain('"@type":"Restaurant"');
    expect(script?.textContent).toContain('"name":"Chez Sokar"');
  });

  it('sets the nonce attribute when provided', () => {
    const { container } = render(<ReservationJsonLd jsonLd={makeJsonLd()} nonce="abc123" />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script?.getAttribute('nonce')).toBe('abc123');
  });

  it('does not set nonce when not provided', () => {
    const { container } = render(<ReservationJsonLd jsonLd={makeJsonLd()} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script?.getAttribute('nonce')).toBeNull();
  });
});
