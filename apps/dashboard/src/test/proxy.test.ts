import { describe, it, expect } from 'vitest';
import { forwardedHeaders } from '../app/api/proxy/forwarded-headers';

/**
 * Garde-fou non-régression : le proxy Next.js /api/proxy/* doit forwarder
 * X-Forwarded-For vers l'API afin que le rate-limit global Fastify s'applique
 * par IP cliente réelle (et non par 127.0.0.1, le proxy local).
 *
 * Contexte (juillet 2026) : toutes les requêtes dashboard passaient par le
 * proxy Next.js et étaient rate-limitées comme venant de 127.0.0.1 (100 req/min
 * partagées entre tous les utilisateurs → 429 en boucle). Le fix : forwarder
 * X-Forwarded-For + activer trustProxy côté API.
 */
function mockReq(headers: Record<string, string>) {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as Parameters<typeof forwardedHeaders>[0];
}

describe('forwardedHeaders — proxy Next.js', () => {
  it("forward X-Forwarded-For vers l'API", () => {
    const headers = forwardedHeaders(mockReq({ 'x-forwarded-for': '203.0.113.7' }));
    expect(headers['X-Forwarded-For']).toBe('203.0.113.7');
  });

  it('forward X-Request-ID pour le tracing end-to-end', () => {
    const headers = forwardedHeaders(mockReq({ 'x-request-id': 'req-abc-123' }));
    expect(headers['X-Request-ID']).toBe('req-abc-123');
  });

  it("forward le cookie Clerk pour l'authentification", () => {
    const headers = forwardedHeaders(mockReq({ cookie: '__session=clerk-session-token' }));
    expect(headers.Cookie).toBe('__session=clerk-session-token');
  });

  it('forward Range pour permettre la lecture et la navigation audio', () => {
    const headers = forwardedHeaders(mockReq({ range: 'bytes=100-499' }));
    expect(headers.Range).toBe('bytes=100-499');
  });

  it('omet les headers absents (pas de valeur vide)', () => {
    const headers = forwardedHeaders(mockReq({}));
    expect(headers).toEqual({});
  });

  it('forward tous les headers simultanément', () => {
    const headers = forwardedHeaders(
      mockReq({
        'x-forwarded-for': '203.0.113.7, 10.0.0.1',
        'x-request-id': 'req-xyz',
        cookie: '__session=tok',
      }),
    );
    expect(headers).toEqual({
      'X-Forwarded-For': '203.0.113.7, 10.0.0.1',
      'X-Request-ID': 'req-xyz',
      Cookie: '__session=tok',
    });
  });
});
