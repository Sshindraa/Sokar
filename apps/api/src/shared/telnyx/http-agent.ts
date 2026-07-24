/**
 * Agent HTTP persistant pour les appels Telnyx via fetch.
 *
 * Node's built-in fetch (undici) maintient un pool de connexions par origin,
 * mais les connexions sont fermées après ~5s d'inactivité. Pour un serveur
 * voice qui ne fait que 1-2 appels Telnyx par appel téléphonique (espacés
 * de plusieurs secondes à minutes), chaque fetch ouvre une nouvelle
 * connexion TLS (113ms de handshake vers Cloudflare edge).
 *
 * Cet agent keep-alive maintient les connexions ouvertes 60s, réduisant
 * la latence de 270ms (cold) à ~20ms (warm) pour les appels Telnyx.
 */
import { Agent } from 'undici';

const TELNYX_API_URL = process.env.TELNYX_API_URL ?? 'https://api.telnyx.com';

export const telnyxAgent = new Agent({
  // Keep-alive: maintient la connexion TCP+TLS ouverte entre les appels
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 120_000,
  // Max connections per origin — largement suffisant pour les appels Telnyx
  connections: 20,
});

/**
 * Wrapper fetch qui utilise l'agent keep-alive persistant pour Telnyx.
 * Le `dispatcher` est une extension Node/undici non standard mais supportée
 * en Node 18+.
 */
export async function telnyxFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${TELNYX_API_URL}${path}`;
  return fetch(url, {
    ...init,
    // @ts-expect-error — dispatcher est une extension undici non typée dans lib.dom
    dispatcher: telnyxAgent,
  });
}

/**
 * Pré-chauffe la connexion Telnyx au démarrage de l'API.
 * Établit la connexion TLS une fois pour que le premier appel téléphonique
 * n'ait pas à payer le handshake de 113ms.
 */
export async function warmupTelnyxConnection(): Promise<void> {
  try {
    // HEAD request — minimal overhead, établit juste la connexion
    await telnyxFetch('/v2/balance', { method: 'HEAD' });
  } catch {
    // 401/404 sont OK — l'important est que la connexion TLS soit établie
  }
}
