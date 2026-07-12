/**
 * Constantes rate-limiting pour les routes RGPD sensibles.
 *
 * Ces limites viennent s'ajouter au rate-limit global 100 req/min/IP et au
 * rate-limit métier par (IP + subject) d'IdentityVerificationService.
 */

import type { FastifyRequest } from 'fastify';
import { env } from '../../env';

export const RATE_LIMIT_REQUEST_VERIFICATION_MAX = 5;
export const RATE_LIMIT_CONFIRM_VERIFICATION_MAX = 10;
export const RATE_LIMIT_CONFIRM_LINK_MAX = 10;
export const RATE_LIMIT_ERASE_MAX = 10;
export const RATE_LIMIT_EXPORT_MAX = 10;
export const RATE_LIMIT_WITHDRAW_MARKETING_MAX = 10;

export const RATE_LIMIT_WINDOW = '1 minute';

/**
 * Bypass du rate-limit Fastify pour les tests unitaires locaux.
 * Le singleton `getApp()` partage le même store ; sans ce bypass, les tests
 * RGPD (qui appellent 11× /request-verification, 7× /confirm-verification, etc.)
 * déclencheraient des 429 avant d'arriver à leurs assertions.
 *
 * En production, `env.NODE_ENV` vaut `production`, donc ce bypass est inactif.
 * `req.ip` est 127.0.0.1 uniquement en local / inject sans X-Forwarded-For.
 */
export function allowLocalhostInTest(req: FastifyRequest): boolean {
  return env.NODE_ENV === 'test' && req.ip === '127.0.0.1';
}

export function rgpdRateLimit(max: number) {
  return {
    max,
    timeWindow: RATE_LIMIT_WINDOW,
    allowList: allowLocalhostInTest,
  };
}
