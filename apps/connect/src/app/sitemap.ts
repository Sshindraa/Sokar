/**
 * Sokar Connect — Sitemap dynamique Next.js.
 *
 * Utilise les endpoints publics /public/sitemap-data et /public/cities
 * (apps/api) plutôt que Prisma direct. Cf. spec v1.1 §6.6 + §7.5.
 *
 * Inclut :
 * - Page d'accueil
 * - Pages restaurant /r/[slug] (tous les publiés)
 * - Pages ville /restaurants/[city] (si ≥5 restos → indexable)
 * - Pages cuisine /restaurants/[city]/[cuisine] (si ville ≥10 ET cuisine ≥5)
 */

import type { MetadataRoute } from 'next';
import { fetchPublishedSlugs, fetchCities } from '@/lib/api-client';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

// Sitemap dynamique — pas de pre-render au build (l'API peut ne pas être
// dispo). Cloudflare cache en edge, donc 1 appel API toutes les 5min.
export const dynamic = 'force-dynamic';
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [slugs, cities] = await Promise.all([fetchPublishedSlugs(), fetchCities()]);

  const restaurantUrls: MetadataRoute.Sitemap = slugs.map((entry) => ({
    url: `${SITE_URL}/r/${entry.slug}`,
    lastModified: new Date(entry.updatedAt ?? entry.publishedAt),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  // Pages ville indexables (≥5 restos dans la ville)
  const cityUrls: MetadataRoute.Sitemap = cities.map((city) => ({
    url: `${SITE_URL}/restaurants/${city.citySlug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // Pages cuisine indexables (ville ≥10 restos ET cuisine ≥5)
  const cuisineUrls: MetadataRoute.Sitemap = cities
    .filter((city) => city.total >= 10)
    .flatMap((city) =>
      city.cuisines
        .filter((cuisine) => cuisine.count >= 5)
        .map((cuisine) => ({
          url: `${SITE_URL}/restaurants/${city.citySlug}/${cuisine.slug}`,
          lastModified: new Date(),
          changeFrequency: 'weekly' as const,
          priority: 0.5,
        })),
    );

  const home: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.5,
    },
  ];

  return [...home, ...restaurantUrls, ...cityUrls, ...cuisineUrls];
}
