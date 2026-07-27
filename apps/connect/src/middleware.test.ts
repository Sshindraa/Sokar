/**
 * Tests unitaires pour le middleware Connect.
 *
 * Vérifie la politique de framing : /widget/* doit pouvoir être embarqué
 * dans un iframe cross-origin, le reste du site reste protégé.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { middleware } from './middleware';

function makeNextUrl(href: string): URL {
  const url = new URL(href);
  // NextURL exposes a .clone() method that plain URL lacks — needed for rewrite paths.
  (url as unknown as { clone: () => URL }).clone = () => makeNextUrl(url.href);
  return url;
}

function makeRequest(
  pathname: string,
  options: { userAgent?: string; preview?: string; host?: string } = {},
): Parameters<typeof middleware>[0] {
  const origin = options.host ? `https://${options.host}` : 'https://sokar.tech';
  const url = new URL(pathname, origin);
  if (options.preview) url.searchParams.set('preview', options.preview);
  const nextUrl = makeNextUrl(url.href);
  const headers = new Headers({ 'user-agent': options.userAgent ?? 'Mozilla/5.0' });
  if (options.host) headers.set('host', options.host);
  return {
    nextUrl,
    headers,
    method: 'GET',
  } as unknown as Parameters<typeof middleware>[0];
}

function getCspFrameAncestors(response: ReturnType<typeof middleware>): string | null {
  const csp = response.headers.get('Content-Security-Policy');
  if (!csp) return null;
  const match = csp.match(/frame-ancestors ([^;]+)/);
  return match ? match[1] : null;
}

describe('middleware framing policy', () => {
  it('denies framing by default', () => {
    const response = middleware(makeRequest('/restaurant/chez-sokar-demo'));
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(getCspFrameAncestors(response)).toBe("'none'");
  });

  it('allows framing on /widget/* from any origin without X-Frame-Options', () => {
    const response = middleware(makeRequest('/widget/chez-sokar-demo'));
    expect(response.headers.get('X-Frame-Options')).toBeNull();
    expect(getCspFrameAncestors(response)).toBe('*');
  });

  it('keeps preview framing restricted to dashboard origin', () => {
    const response = middleware(makeRequest('/restaurant/chez-sokar-demo', { preview: '1' }));
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(getCspFrameAncestors(response)).toBe("'self'");
  });
});

describe('middleware subdomain routing (*.sokar.tech)', () => {
  // Le custom domain flow nécessite API_URL pour déclencher le rewrite.
  let originalApiUrl: string | undefined;
  beforeAll(() => {
    originalApiUrl = process.env.API_URL;
    process.env.API_URL = 'http://localhost:4000';
  });
  afterAll(() => {
    if (originalApiUrl === undefined) delete process.env.API_URL;
    else process.env.API_URL = originalApiUrl;
  });

  it('rewrites chezmario.sokar.tech to /restaurant/chezmario', () => {
    const response = middleware(makeRequest('/', { host: 'chezmario.sokar.tech' }));
    // NextResponse.rewrite returns a response whose .headers includes the rewritten URL
    // in the `x-middleware-rewrite` header (Next.js internal).
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://chezmario.sokar.tech/restaurant/chezmario');
  });

  it('does not rewrite www.sokar.tech (primary host)', () => {
    const response = middleware(makeRequest('/', { host: 'www.sokar.tech' }));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('does not rewrite sokar.tech (primary host)', () => {
    const response = middleware(makeRequest('/', { host: 'sokar.tech' }));
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
  });

  it('rewrites custom domain reserve.chezmario.fr to /custom-domain', () => {
    const response = middleware(makeRequest('/', { host: 'reserve.chezmario.fr' }));
    const rewrite = response.headers.get('x-middleware-rewrite');
    expect(rewrite).toContain('/custom-domain');
    expect(rewrite).toContain('host=reserve.chezmario.fr');
  });

  it('does not rewrite to /restaurant/ when slug is empty (host === .sokar.tech)', () => {
    // host = ".sokar.tech" → slug would be empty → no subdomain rewrite.
    // Falls through to custom-domain flow (not a /restaurant/ rewrite).
    const response = middleware(makeRequest('/', { host: '.sokar.tech' }));
    const rewrite = response.headers.get('x-middleware-rewrite');
    // Soit pas de rewrite, soit un rewrite vers /custom-domain (jamais /restaurant/).
    if (rewrite) {
      expect(rewrite).not.toContain('/restaurant/');
    }
  });

  it('rewrites multi-dot subdomain foo.bar.sokar.tech to /restaurant/foo.bar', () => {
    // Le slug est tout ce qui précède .sokar.tech, y compris les dots internes.
    // foo.bar.sokar.tech → slug = "foo.bar" → /restaurant/foo.bar
    // Comportement documenté : on accepte les dots dans le slug (pas de validation
    // de format ici — la page /restaurant/[slug] retournera notFound() si invalide).
    const response = middleware(makeRequest('/', { host: 'foo.bar.sokar.tech' }));
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://foo.bar.sokar.tech/restaurant/foo.bar',
    );
  });

  it('handles uppercase subdomain (browsers lowercase the host, but test the edge)', () => {
    // Les navigateurs lowercaset le host avant l'envoi. Si un client envoie
    // quand même un host en majuscules (ex: CHEZMARIO.sokar.tech), le middleware
    // match car endsWith('.sokar.tech') est sensible à la casse mais le suffixe
    // .sokar.tech reste en minuscules. Le slug est préservé en majuscules dans
    // la rewrite — la page /restaurant/[slug] retournera notFound() car les slugs
    // en DB sont lowercase. Comportement documenté : pas de normalisation de casse
    // dans le middleware (Edge), la validation se fait côté page.
    const response = middleware(makeRequest('/', { host: 'CHEZMARIO.sokar.tech' }));
    const rewrite = response.headers.get('x-middleware-rewrite');
    expect(rewrite).toContain('/restaurant/CHEZMARIO');
  });
});
