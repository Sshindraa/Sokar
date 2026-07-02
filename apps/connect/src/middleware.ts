/**
 * Sokar Connect — Middleware sécurité.
 *
 * Headers ajoutés sur toutes les réponses :
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY (anti-clickjacking) — relaxé en SAMEORIGIN si ?preview=1
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Content-Security-Policy (autorise JSON-LD inline scripts et Cloudinary images)
 *
 * En mode preview (?preview=1), on autorise l'embedding iframe depuis le
 * dashboard (cf. spec connect-v1.1 §13.5). DASHBOARD_URL (env) contient
 * l'origine du dashboard — en prod c'est le même domaine (sokar.tech),
 * en dev c'est http://localhost:3000.
 *
 * Cf. spec connect-v1.1 §21.4 (sécurité) et §17.3 (performance).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Bots IA à tracker (pour mesurer l'efficacité réelle du web crawl).
// Loggué côté serveur via console.log (récupéré par PM2 / Docker logs).
const IA_BOTS = [
  'OAI-SearchBot',
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Bytespider',
  'CCBot',
  'Googlebot',
  'Bingbot',
  'Applebot',
];

function detectBot(userAgent: string): string | null {
  for (const bot of IA_BOTS) {
    if (userAgent.includes(bot)) return bot;
  }
  return null;
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Instrumentation : log les hits par bot IA sur les pages publiques.
  // Permet de savoir quels bots crawlent réellement Sokar (vs hypothèse).
  const userAgent = request.headers.get('user-agent') ?? '';
  const bot = detectBot(userAgent);
  if (bot) {
    const path = request.nextUrl.pathname;
    // Ne log que les pages intéressantes (pas les assets)
    if (
      path.startsWith('/restaurant/') ||
      path === '/llms.txt' ||
      path === '/robots.txt' ||
      path === '/sitemap.xml' ||
      path.startsWith('/.well-known/')
    ) {
      // Log structuré pour PM2/Docker logs (instrumentation bots IA).
      // console.log est supporté par l'Edge Runtime (pas process.stdout).
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          type: 'ia_bot_hit',
          bot,
          path,
          method: request.method,
          ts: new Date().toISOString(),
        }),
      );

      // Forward en fire-and-forget vers l'API analytics pour incrémenter
      // la métrique Prometheus sokar_connect_ia_bot_hits_total (cf. Phase 1
      // observabilité). Best-effort : ne bloque pas la réponse.
      const apiUrl = process.env.API_URL;
      if (apiUrl) {
        fetch(`${apiUrl}/public/analytics/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: 'ia_bot_hit', bot, path }),
          cache: 'no-store',
          keepalive: true,
        }).catch(() => {
          // Best-effort : on ignore les erreurs (API down, réseau)
        });
      }
    }
  }

  // ?preview=1 — mode preview dashboard (noindex, framing autorisé)
  const isPreview = request.nextUrl.searchParams.get('preview') === '1';

  // HSTS — force HTTPS pendant 2 ans (aligné avec nginx, spec §8.2)
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

  // Anti-MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Anti-clickjacking — DENY par défaut, SAMEORIGIN en preview
  response.headers.set('X-Frame-Options', isPreview ? 'SAMEORIGIN' : 'DENY');

  // Pas de referrer vers des sites tiers non approuvés
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy : pas d'accès aux APIs sensibles du navigateur
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );

  // frame-ancestors : 'none' par défaut, 'self' + DASHBOARD_URL en preview
  const dashboardUrl = process.env.DASHBOARD_URL;
  const frameAncestors = isPreview
    ? dashboardUrl
      ? `'self' ${dashboardUrl}`
      : "'self'"
    : "'none'";

  // CSP : autorise le JSON-LD inline (spec §8), les images Cloudinary,
  // et le self pour les scripts/styles. Pas d'eval, pas d'object-src.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // JSON-LD inline (cf. spec v1.1 §8)
    "style-src 'self' 'unsafe-inline'", // Tailwind inline styles
    "img-src 'self' https://res.cloudinary.com https://images.unsplash.com https://sokar.app data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match toutes les routes SAUF les assets statiques (Next les sert
     * sans passer par le middleware pour la perf).
     */
    '/((?!connect-assets|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)).*)',
  ],
};
