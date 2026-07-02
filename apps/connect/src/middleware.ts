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

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

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
