/**
 * Sokar Connect P2 — Cloudflare for SaaS Custom Hostnames.
 *
 * Provisionne et gère les custom domains des restaurants via l'API Cloudflare.
 * Le restaurateur configure un CNAME vers sokar.tech, Cloudflare provisionne
 * automatiquement le SSL (no certbot, no manual certs).
 *
 * Flux :
 *   1. setCustomDomain(domain) → createCustomHostname(domain) → status pending
 *   2. Restaurateur configure CNAME → reserve.chezmario.fr → sokar.tech
 *   3. Cloudflare valide le DNS + provisionne SSL → status active
 *   4. Middleware Connect détecte le host → lookup DB → rewrite /restaurant/[slug]
 *
 * Env vars requises :
 *   - CLOUDFLARE_API_TOKEN : API token avec permissions Cloudflare for SaaS
 *   - CLOUDFLARE_ZONE_ID   : Zone ID du domaine sokar.tech
 *   - CLOUDFLARE_SAAS_FALLBACK_ORIGIN : fallback origin (ex: sokar.tech)
 *
 * Si les env vars ne sont pas set, le service est désactivé (no-op) — utile pour
 * les tests et le dev local.
 */

import { logger } from '../../shared/logger/pino';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export type CustomHostnameStatus =
  | 'pending'
  | 'dns_validated'
  | 'ssl_provisioning'
  | 'active'
  | 'failed';

export type CustomHostnameResponse = {
  id: string; // Cloudflare Custom Hostname ID
  hostname: string;
  status: CustomHostnameStatus;
  sslStatus?: string; // pending_validation, provisioning, active, etc.
};

export type CloudflareSaaSConfig = {
  apiToken: string;
  zoneId: string;
  fallbackOrigin: string;
};

function getConfig(): CloudflareSaaSConfig | null {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const fallbackOrigin = process.env.CLOUDFLARE_SAAS_FALLBACK_ORIGIN ?? 'sokar.tech';
  if (!apiToken || !zoneId) {
    return null;
  }
  return { apiToken, zoneId, fallbackOrigin };
}

export function isCloudflareSaaSEnabled(): boolean {
  return getConfig() !== null;
}

export function mapStatus(
  cfStatus: string,
  sslStatus: string | undefined,
): CustomHostnameStatus {
  // Cloudflare statuses: pending, active, moved, deleted
  // SSL statuses: pending_validation, pending_issuance, provisioning, active, etc.
  if (cfStatus === 'active' && sslStatus === 'active') return 'active';
  if (cfStatus === 'active' && sslStatus && sslStatus !== 'active')
    return 'ssl_provisioning';
  if (cfStatus === 'pending') return 'dns_validated';
  if (cfStatus === 'moved' || cfStatus === 'deleted') return 'failed';
  return 'pending';
}

async function cfFetch(
  path: string,
  options: RequestInit = {},
  config: CloudflareSaaSConfig,
): Promise<any> {
  const res = await fetch(`${CF_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = (await res.json()) as {
    success: boolean;
    errors?: Array<{ message: string }>;
    result: any;
  };
  if (!res.ok || !body.success) {
    const errors = body.errors?.map((e: any) => e.message).join(', ') ?? 'unknown';
    logger.error(
      { path, status: res.status, errors },
      '[cloudflare-saas] API error',
    );
    throw new Error(`Cloudflare API error: ${errors}`);
  }
  return body.result;
}

/**
 * Crée un Custom Hostname sur Cloudflare for SaaS.
 * Le restaurateur doit ensuite configurer un CNAME vers sokar.tech.
 */
export async function createCustomHostname(
  hostname: string,
): Promise<CustomHostnameResponse> {
  const config = getConfig();
  if (!config) {
    throw new Error('Cloudflare for SaaS is not configured (missing env vars)');
  }

  const result = await cfFetch(
    `/zones/${config.zoneId}/custom_hostnames`,
    {
      method: 'POST',
      body: JSON.stringify({
        hostname,
        ssl: {
          method: 'http',
          type: 'dv',
          settings: {
            min_tls_version: '1.2',
          },
        },
      }),
    },
    config,
  );

  const status = mapStatus(result.status, result.ssl?.status);
  logger.info(
    { hostname, cfId: result.id, status },
    '[cloudflare-saas] Custom Hostname created',
  );

  return {
    id: result.id,
    hostname: result.hostname,
    status,
    sslStatus: result.ssl?.status,
  };
}

/**
 * Récupère le statut d'un Custom Hostname existant.
 */
export async function getCustomHostname(
  cfId: string,
): Promise<CustomHostnameResponse> {
  const config = getConfig();
  if (!config) {
    throw new Error('Cloudflare for SaaS is not configured (missing env vars)');
  }

  const result = await cfFetch(
    `/zones/${config.zoneId}/custom_hostnames/${cfId}`,
    { method: 'GET' },
    config,
  );

  const status = mapStatus(result.status, result.ssl?.status);
  return {
    id: result.id,
    hostname: result.hostname,
    status,
    sslStatus: result.ssl?.status,
  };
}

/**
 * Supprime un Custom Hostname (quand le restaurateur désactive son custom domain).
 */
export async function deleteCustomHostname(cfId: string): Promise<void> {
  const config = getConfig();
  if (!config) {
    throw new Error('Cloudflare for SaaS is not configured (missing env vars)');
  }

  await cfFetch(
    `/zones/${config.zoneId}/custom_hostnames/${cfId}`,
    { method: 'DELETE' },
    config,
  );

  logger.info({ cfId }, '[cloudflare-saas] Custom Hostname deleted');
}

/**
 * Valide qu'un CNAME pointe bien vers sokar.tech (vérification DNS locale).
 * Utile pour donner un feedback immédiat au restaurateur avant que Cloudflare
 * ne valide.
 */
export async function verifyCname(hostname: string): Promise<{
  valid: boolean;
  target: string | null;
  message: string;
}> {
  try {
    // DNS lookup via dig (available on the VPS)
    const { execSync } = await import('node:child_process');
    const output = execSync(`dig +short CNAME ${hostname}`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();

    if (!output) {
      // Try A record (some registrars flatten CNAME)
      const aOutput = execSync(`dig +short A ${hostname}`, {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();
      if (aOutput) {
        return {
          valid: false,
          target: aOutput.split('\n')[0],
          message:
            'Le DNS pointe vers une adresse IP (A record) au lieu d’un CNAME. Configurez un CNAME vers sokar.tech.',
        };
      }
      return {
        valid: false,
        target: null,
        message:
          'Aucun enregistrement DNS trouvé. Configurez un CNAME vers sokar.tech.',
      };
    }

    const target = output.replace(/\.$/, ''); // remove trailing dot
    const config = getConfig();
    const expectedTarget = config?.fallbackOrigin ?? 'sokar.tech';

    if (target === expectedTarget || target.endsWith(`.${expectedTarget}`)) {
      return {
        valid: true,
        target,
        message: 'CNAME correctement configuré vers sokar.tech.',
      };
    }

    return {
      valid: false,
      target,
      message: `Le CNAME pointe vers ${target} au lieu de ${expectedTarget}. Corrigez la destination du CNAME.`,
    };
  } catch (err) {
    logger.error({ err, hostname }, '[cloudflare-saas] DNS lookup failed');
    return {
      valid: false,
      target: null,
      message: 'Impossible de vérifier le DNS. Réessayez dans quelques minutes.',
    };
  }
}
