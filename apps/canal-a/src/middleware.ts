/**
 * Canal A — Middleware sécurité.
 *
 * Headers ajoutés sur toutes les réponses :
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options: nosniff
 * - X-Frame-Options: DENY (anti-clickjacking)
 * - Referrer-Policy: strict-origin-when-cross-origin
 * - Content-Security-Policy (autorise JSON-LD inline scripts et Cloudinary images)
 *
 * Cf. spec canal-a-v1.1 §21.4 (sécurité) et §17.3 (performance).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // HSTS — force HTTPS pendant 1 an
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  // Anti-MIME sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Anti-clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Pas de referrer vers des sites tiers non approuvés
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions-Policy : pas d'accès aux APIs sensibles du navigateur
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );

  // CSP : autorise le JSON-LD inline (spec §8), les images Cloudinary,
  // et le self pour les scripts/styles. Pas d'eval, pas d'object-src.
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'", // JSON-LD inline (cf. spec v1.1 §8)
    "style-src 'self' 'unsafe-inline'", // Tailwind inline styles
    "img-src 'self' https://res.cloudinary.com https://images.unsplash.com https://sokar.app data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)).*)',
  ],
};
