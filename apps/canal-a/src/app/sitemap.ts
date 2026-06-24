/**
 * Canal A — Sitemap dynamique Next.js.
 *
 * Utilise l'endpoint public /public/sitemap-data (apps/api) plutôt que
 * Prisma direct. Cf. spec v1.1 §6.6.
 */

import type { MetadataRoute } from 'next';
import { fetchPublishedSlugs } from '@/lib/api-client';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

// Sitemap dynamique — pas de pre-render au build (l'API peut ne pas être
// dispo). Cloudflare cache en edge, donc 1 appel API toutes les 5min.
export const dynamic = 'force-dynamic';
export const revalidate = 300;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await fetchPublishedSlugs();

  const restaurantUrls: MetadataRoute.Sitemap = slugs.map((entry) => ({
    url: `${SITE_URL}/r/${entry.slug}`,
    lastModified: new Date(entry.updatedAt ?? entry.publishedAt),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  const home: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.5,
    },
  ];

  return [...home, ...restaurantUrls];
}
