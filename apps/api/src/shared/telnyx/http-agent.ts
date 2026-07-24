/**
 * Wrapper fetch avec keep-alive pour les appels Telnyx.
 *
 * Node's built-in fetch maintient un pool de connexions par origin, mais
 * sans `keepalive: true`, les connexions sont fermées après chaque requête.
 * Pour un serveur voice qui fait 1-2 appels Telnyx par appel téléphonique
 * (answer, speak, record), chaque fetch ouvre une nouvelle connexion TLS
 * (~113ms de handshake vers Cloudflare edge).
 *
 * Avec `keepalive: true`, le pool de connexions est réutilisé :
 * - Cold (premier appel) : ~200ms (TLS handshake + requête)
 * - Warm (appels suivants) : ~20-35ms (-85%)
 *
 * Benchmark Frankfurt VPS → api.telnyx.eu :
 *   sans keepalive : 204ms, 70ms, 37ms (ferme à chaque fois)
 *   avec keepalive : 33ms, 24ms, 35ms, 39ms, 28ms (connexion réutilisée)
 */

const TELNYX_API_URL = process.env.TELNYX_API_URL ?? 'https://api.telnyx.com';

/**
 * Agent keep-alive pour les appels fetch qui utilisent un objet URL
 * (ex: call-recording.service.ts qui construit une URL avec query params).
 * Passé via `dispatcher` — extension undici de Node 18+.
 */
import * as https from 'https';

export const telnyxAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60_000,
});

/**
 * Wrapper fetch qui active keepalive pour réutiliser la connexion TLS.
 */
export async function telnyxFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const url = path.startsWith('http') ? path : `${TELNYX_API_URL}${path}`;
  return fetch(url, {
    ...init,
    keepalive: true,
  });
}

/**
 * Pré-chauffe la connexion Telnyx au démarrage de l'API.
 * Établit la connexion TLS une fois pour que le premier appel téléphonique
 * n'ait pas à payer le handshake de ~113ms.
 */
export async function warmupTelnyxConnection(): Promise<void> {
  // Warmup the fetch keepalive pool (used by telnyxFetch for answer/speak/record)
  try {
    await telnyxFetch('/v2/balance', { method: 'HEAD' });
  } catch {
    // 401/404 sont OK — l'important est que la connexion TLS soit établie
  }

  // Warmup the Telnyx SDK (uses https.Agent keep-alive for balance/SMS/WhatsApp)
  try {
    const telnyx = (await import('./client')).default;
    await telnyx.balance.retrieve();
  } catch {
    // Non-blocking — la connexion TLS est établie même si l'auth échoue
  }
}
