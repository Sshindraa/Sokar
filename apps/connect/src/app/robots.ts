/**
 * Sokar Connect — robots.txt dynamique.
 *
 * Cf. spec connect-v1.1 §11.
 *
 * - Allow / pour tous les bots (incl. OAI-SearchBot pour ChatGPT Search)
 * - Allow pages publiques
 * - Disallow /admin, /dashboard, /api (pas exposés, mais ceinture+bretelles)
 * - Référence le sitemap
 *
 * Note : GPTBot est allow par défaut (à durcir P5 si usage intensif).
 * Cf. https://platform.openai.com/docs/bots
 */

import type { MetadataRoute } from 'next';

const SITE_URL = process.env.SITE_URL ?? 'https://sokar.tech';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/dashboard/', '/api/'],
      },
      {
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: ['/admin/', '/dashboard/', '/api/'],
      },
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: ['/admin/', '/dashboard/', '/api/'],
      },
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/admin/', '/dashboard/', '/api/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
