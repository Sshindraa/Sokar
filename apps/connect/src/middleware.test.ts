/**
 * Tests unitaires pour le middleware Connect.
 *
 * Vérifie la politique de framing : /widget/* doit pouvoir être embarqué
 * dans un iframe cross-origin, le reste du site reste protégé.
 */

import { describe, it, expect } from 'vitest';
import { middleware } from './middleware';

function makeRequest(
  pathname: string,
  options: { userAgent?: string; preview?: string } = {},
): any {
  const url = new URL(pathname, 'https://sokar.tech');
  if (options.preview) url.searchParams.set('preview', options.preview);
  return {
    nextUrl: url,
    headers: new Headers({ 'user-agent': options.userAgent ?? 'Mozilla/5.0' }),
    method: 'GET',
  };
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
