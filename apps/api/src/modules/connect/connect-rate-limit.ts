/**
 * Sokar Connect — Rate limits per-phone (spec v1.1 §8.3 + §8.6).
 *
 * Les rate limits par IP sont gérés par @fastify/rate-limit (config route).
 * Les rate limits par téléphone nécessitent Redis direct (INCR + EXPIRE)
 * car le phone est dans le body, pas dans l'IP.
 *
 * Limites :
 * - Hold : 20 req/phone/jour (24h)
 * - Confirm : 5 req/phone/heure
 * - Anti-spam : 3 confirmations échouées en 1h → blocage 24h
 */

import { redisCache } from '../../shared/redis/client';
import { alertFailOpen } from '../../shared/observability/alerts';

const HOLD_DAILY_LIMIT = 20;
const CONFIRM_HOURLY_LIMIT = 5;
const FAILED_CONFIRM_THRESHOLD = 3;

function holdKey(phoneHash: string): string {
  return `connect:rl:hold:${phoneHash}`;
}

function confirmKey(phoneHash: string): string {
  return `connect:rl:confirm:${phoneHash}`;
}

function failedConfirmKey(phoneHash: string): string {
  return `connect:rl:failed:${phoneHash}`;
}

function blockedKey(phoneHash: string): string {
  return `connect:rl:blocked:${phoneHash}`;
}

const DAY_SECONDS = 86400;
const HOUR_SECONDS = 3600;

/**
 * Vérifie si un phone peut créer un hold (max 20/jour).
 * Retourne true si autorisé, false si limit atteinte.
 * Incrémente le compteur si autorisé.
 *
 * Fail-open : si Redis est down, on accepte la requête (avec warning log).
 * Le rate limit IP (@fastify/rate-limit) reste actif comme safety net.
 */
export async function canCreateHold(phoneHash: string): Promise<boolean> {
  try {
    const key = holdKey(phoneHash);
    const count = await redisCache.incr(key);
    if (count === 1) {
      await redisCache.expire(key, DAY_SECONDS);
    }
    return count <= HOLD_DAILY_LIMIT;
  } catch (err) {
    alertFailOpen({ source: 'connect_rate_limit', reason: 'canCreateHold_redis_down', err });
    return true;
  }
}

/**
 * Vérifie si un phone peut confirmer (max 5/heure + pas bloqué).
 * Retourne true si autorisé, false si limit atteinte ou bloqué.
 * Incrémente le compteur si autorisé.
 *
 * Fail-open : si Redis est down, on accepte la requête (avec warning log).
 */
export async function canConfirm(phoneHash: string): Promise<boolean> {
  try {
    // Check blocage anti-spam d'abord
    const blocked = await redisCache.get(blockedKey(phoneHash));
    if (blocked) return false;

    const key = confirmKey(phoneHash);
    const count = await redisCache.incr(key);
    if (count === 1) {
      await redisCache.expire(key, HOUR_SECONDS);
    }
    return count <= CONFIRM_HOURLY_LIMIT;
  } catch (err) {
    alertFailOpen({ source: 'connect_rate_limit', reason: 'canConfirm_redis_down', err });
    return true;
  }
}

/**
 * Enregistre une confirmation échouée. Si ≥3 échecs en 1h → blocage 24h.
 * Best-effort : si Redis est down, l'échec n'est pas enregistré (non-bloquant).
 */
export async function recordFailedConfirm(phoneHash: string): Promise<void> {
  try {
    const key = failedConfirmKey(phoneHash);
    const count = await redisCache.incr(key);
    if (count === 1) {
      await redisCache.expire(key, HOUR_SECONDS);
    }
    if (count >= FAILED_CONFIRM_THRESHOLD) {
      await redisCache.set(blockedKey(phoneHash), '1', 'EX', DAY_SECONDS);
    }
  } catch (err) {
    alertFailOpen({ source: 'connect_rate_limit', reason: 'recordFailedConfirm_redis_down', err });
  }
}
