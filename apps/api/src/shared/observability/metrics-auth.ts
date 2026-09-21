import { env } from '../../env';

/**
 * Garde d'accès à `/metrics`, partagée par l'API (route Fastify) et par le
 * process worker (petit serveur HTTP). Deux modes, dans cet ordre :
 *
 *  1. auth basique si `METRICS_BASIC_AUTH_USER` + `METRICS_BASIC_AUTH_PASSWORD`
 *     sont définis — c'est le mode attendu dès que Prometheus scrape depuis un
 *     conteneur, où l'IP source n'est pas la loopback ;
 *  2. sinon allowlist d'IP (`METRICS_ALLOWLIST_IPS`, loopback par défaut).
 */
export type MetricsAuthResult = { ok: true } | { ok: false; status: 401 | 403 };

export function metricsAllowlist(): string[] {
  return (env.METRICS_ALLOWLIST_IPS ?? '127.0.0.1, ::1')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
}

/** `::ffff:127.0.0.1` → `127.0.0.1` : sans ça, l'allowlist loopback échoue. */
export function normalizeRemoteAddress(address: string | undefined): string {
  if (!address) return '';
  return address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
}

export function checkMetricsAuth(input: {
  authorization?: string | undefined;
  remoteAddress?: string | undefined;
}): MetricsAuthResult {
  const user = env.METRICS_BASIC_AUTH_USER;
  const password = env.METRICS_BASIC_AUTH_PASSWORD;

  if (user && password) {
    const header = input.authorization;
    if (!header || !header.toLowerCase().startsWith('basic ')) return { ok: false, status: 401 };
    const decoded = Buffer.from(header.slice(6), 'base64').toString();
    const separator = decoded.indexOf(':');
    const clientUser = separator === -1 ? decoded : decoded.slice(0, separator);
    const clientPassword = separator === -1 ? '' : decoded.slice(separator + 1);
    if (clientUser !== user || clientPassword !== password) return { ok: false, status: 401 };
    return { ok: true };
  }

  const address = normalizeRemoteAddress(input.remoteAddress);
  if (!metricsAllowlist().includes(address)) return { ok: false, status: 403 };
  return { ok: true };
}
