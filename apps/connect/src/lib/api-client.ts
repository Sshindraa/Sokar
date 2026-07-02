/**
 * Sokar Connect — API client.
 *
 * En T4, on fetch l'API publique Fastify (apps/api) plutôt que d'importer
 * directement @sokar/database. Cf. spec connect-v1.1 §6.6 :
 *   "apps/connect appelle GET /public/sitemap-data plutôt que
 *    d'importer du code apps/api directement."
 *
 * Avantages :
 * - Pas de couplage Prisma dans le build Next.js (sinon il faudrait
 *   builder le package database — anti-pattern workspace).
 * - API contractuel : le JSON est le même pour le front, l'admin, et les
 *   tests externes.
 * - Cacheable côté CDN (cf. spec §17.3 performance cible).
 *
 * Tradeoff : 1 requête HTTP supplémentaire par page. Acceptable
 * parce que (1) Next.js ISR cache 60s, (2) le cache L'API côté Fastify
 *   est 60s, (3) Cloudflare cache en edge.
 */

const API_URL = process.env.API_URL ?? 'http://localhost:3001';

async function getApiUrl(): Promise<string> {
  // In server components, prefer API_URL (internal, no DNS resolution overhead).
  // Falls back to NEXT_PUBLIC_API_URL for client-side usage.
  if (typeof window === 'undefined') {
    return process.env.API_URL ?? 'http://localhost:3001';
  }
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? 'http://localhost:3001';
}

export type PublicRestaurantDto = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  address: {
    line1: string;
    postalCode?: string;
    city: string;
    country: string;
  };
  phone: string;
  cuisineTypes: string[];
  priceRange?: string;
  openingHours: Array<{ day: string; open: string; close: string }>;
  reservationUrl: string;
  images: { cover?: string; gallery: string[] };
  ambiance?: string[];
  dietary?: string[];
  noiseLevel?: string;
  acceptsReservations: boolean;
  publishedAt: string;
  connectAgentic: boolean;
  // Note agrégée (importée Google Places, Phase 3). Absent si pas de Place ID.
  aggregateRating?: {
    ratingValue: number;
    reviewCount: number;
    provider: 'google';
  };
};

export type AvailabilityDto = {
  restaurantId: string;
  date: string;
  partySize: number;
  slots: Array<{ time: string; available: boolean }>;
};

export type SitemapRestaurantEntry = {
  slug: string;
  updatedAt: string;
  publishedAt: string;
};

/**
 * Récupère un restaurant publié par slug.
 * Renvoie null si introuvable ou non publié (404 géré).
 */
export async function fetchPublicRestaurant(
  slug: string,
  options: { revalidate?: number; tags?: string[]; preview?: boolean } = {},
): Promise<PublicRestaurantDto | null> {
  try {
    const query = options.preview ? '?preview=1' : '';
    const res = await fetch(`${await getApiUrl()}/public/r/${slug}${query}`, {
      next: {
        revalidate: options.preview ? 0 : (options.revalidate ?? 60),
        tags: options.tags ?? [`restaurant:${slug}`],
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.error(`[connect] fetch restaurant ${slug} failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as PublicRestaurantDto;
  } catch (err) {
    console.error(`[connect] fetch restaurant ${slug} error:`, err);
    return null;
  }
}

/**
 * Récupère les slots disponibles pour (restaurantId, date, partySize).
 * Endpoint : GET /public/r/:slug/availability
 */
export async function fetchAvailability(
  slug: string,
  args: { date: string; partySize: number },
  options: { revalidate?: number } = {},
): Promise<AvailabilityDto | null> {
  try {
    const params = new URLSearchParams({
      date: args.date,
      partySize: String(args.partySize),
    });
    const res = await fetch(`${await getApiUrl()}/public/r/${slug}/availability?${params}`, {
      next: { revalidate: options.revalidate ?? 30 },
    });
    if (!res.ok) {
      console.error(`[connect] fetch availability ${slug} failed: ${res.status}`);
      return null;
    }
    return (await res.json()) as AvailabilityDto;
  } catch (err) {
    console.error(`[connect] fetch availability ${slug} error:`, err);
    return null;
  }
}

/**
 * Liste tous les slugs publiés pour le sitemap.
 * Endpoint : GET /public/sitemap-data
 * Cf. spec v1.1 §6.6 (le T8 utilise cet endpoint plutôt que Prisma direct).
 */
export async function fetchPublishedSlugs(): Promise<SitemapRestaurantEntry[]> {
  try {
    const res = await fetch(`${await getApiUrl()}/public/sitemap-data`, {
      next: { revalidate: 300 }, // 5 min
    });
    if (!res.ok) {
      console.error(`[connect] fetch sitemap-data failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { restaurants: SitemapRestaurantEntry[] };
    return data.restaurants;
  } catch (err) {
    console.error(`[connect] fetch sitemap-data error:`, err);
    return [];
  }
}

/**
 * Liste des villes avec compteurs (T7).
 * Endpoint : GET /public/cities
 */
export async function fetchCities(): Promise<
  Array<{
    city: string;
    citySlug: string;
    total: number;
    cuisines: Array<{ name: string; slug: string; count: number }>;
  }>
> {
  try {
    const res = await fetch(`${await getApiUrl()}/public/cities`, {
      next: { revalidate: 300 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      cities: Array<{
        city: string;
        citySlug: string;
        total: number;
        cuisines: Array<{ name: string; slug: string; count: number }>;
      }>;
    };
    return data.cities;
  } catch (err) {
    console.error(`[connect] fetch cities error:`, err);
    return [];
  }
}

/**
 * Page ville (T7) : restaurants d'une ville (avec filtre cuisine optionnel).
 * Endpoint : GET /public/cities/:slug?cuisine=
 */
export async function fetchCityPage(
  citySlug: string,
  cuisine?: string,
): Promise<import('./cities').CityCuisinePageData | null> {
  try {
    const params = new URLSearchParams();
    if (cuisine) params.set('cuisine', cuisine);
    const url = `${await getApiUrl()}/public/cities/${citySlug}${params.toString() ? `?${params}` : ''}`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as import('./cities').CityCuisinePageData;
  } catch (err) {
    console.error(`[connect] fetch city ${citySlug} error:`, err);
    return null;
  }
}
