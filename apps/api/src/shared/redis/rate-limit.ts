/**
 * Rate limiting simple basé sur Redis (compteur par clé + fenêtre fixe).
 *
 * Utilisé pour limiter les appels aux routes qui créent des PaymentIntents
 * Stripe (10 req/min/IP) et éviter l'abus.
 */
import { redisCache } from './client';
import { logger } from '../logger/pino';

const WINDOW_SECONDS = 60;
const DEFAULT_LIMIT = 10;

/**
 * Vérifie si la clé a dépassé la limite dans la fenêtre courante.
 * Incrémente le compteur atomiquement via INCR + EXPIRE.
 *
 * @returns true si la requête est autorisée, false si la limite est dépassée.
 */
export async function checkRateLimit(key: string, limit: number = DEFAULT_LIMIT): Promise<boolean> {
  try {
    const count = await redisCache.incr(key);
    if (count === 1) {
      // Première requête dans la fenêtre — définir le TTL
      await redisCache.expire(key, WINDOW_SECONDS);
    }
    return count <= limit;
  } catch (err: unknown) {
    // Si Redis est down, on laisse passer (fail-open) pour ne pas bloquer
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      '[rate-limit] Redis unavailable, failing open',
    );
    return true;
  }
}

/**
 * Construit la clé de rate limiting pour une route + IP.
 */
export function rateLimitKey(route: string, ip: string): string {
  return `ratelimit:${route}:${ip}`;
}

/**
 * Extrait l'IP du client depuis la requête Fastify.
 * Gère les proxies (X-Forwarded-For).
 */
export function getClientIp(req: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  raw?: { socket?: { remoteAddress?: string } };
}): string {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return ip.trim();
  }
  return req.ip ?? req.raw?.socket?.remoteAddress ?? 'unknown';
}
