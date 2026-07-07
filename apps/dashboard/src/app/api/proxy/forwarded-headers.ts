import type { NextRequest } from 'next/server';

/**
 * Extrait les headers à forwarder vers l'API depuis la requête entrante.
 * Exporté dans un module séparé (et non depuis route.ts) car Next.js interdit
 * les exports non-route depuis les fichiers route handlers.
 *
 * Garde-fou non-régression : X-Forwarded-For doit être forwardé pour que le
 * rate-limit global Fastify s'applique par IP cliente réelle (trustProxy).
 */
export function forwardedHeaders(req: NextRequest) {
  const cookie = req.headers.get('cookie') || '';
  const forwardedFor = req.headers.get('x-forwarded-for') || '';
  const requestId = req.headers.get('x-request-id') || '';

  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  if (forwardedFor) headers['X-Forwarded-For'] = forwardedFor;
  if (requestId) headers['X-Request-ID'] = requestId;
  return headers;
}
