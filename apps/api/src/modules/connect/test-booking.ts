/**
 * Réservation test — jeton signé, drapeau et quota.
 *
 * Le jeton lie un restaurant à une expiration (1 h), signé en HMAC-SHA256 avec
 * TEST_BOOKING_SECRET (32 octets en 64 caractères hexadécimaux, key_env).
 * Format : base64url(payload).base64url(signature), payload = UUID (16 octets)
 * + expiration en secondes (uint32).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { redisCache } from '../../shared/redis/client';
import { alertFailOpen } from '../../shared/observability/alerts';

export const TEST_BOOKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{27}\.[A-Za-z0-9_-]{43}$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_TTL_SECONDS = 3600;
const QUOTA_LIMIT = 5;
const QUOTA_TTL_SECONDS = 86400;

function secret(): Buffer | undefined {
  const value = process.env.TEST_BOOKING_SECRET;
  return value && /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : undefined;
}

export function isTestBookingEnabled(): boolean {
  return process.env.TEST_BOOKING_ENABLED === 'true' && !!secret();
}

function sign(payload: Buffer, key: Buffer): Buffer {
  return createHmac('sha256', key).update('test-booking-v1\0').update(payload).digest();
}

export function issueTestBookingToken(restaurantId: string, now = new Date()): string {
  const key = secret();
  if (!key) throw new Error('TEST_BOOKING_SECRET manquant ou invalide');
  if (!UUID.test(restaurantId)) throw new Error('restaurantId invalide');
  const expires = Math.floor(now.getTime() / 1000) + TOKEN_TTL_SECONDS;
  const payload = Buffer.alloc(20);
  Buffer.from(restaurantId.replace(/-/g, ''), 'hex').copy(payload);
  payload.writeUInt32BE(expires, 16);
  return `${payload.toString('base64url')}.${sign(payload, key).toString('base64url')}`;
}

export function verifyTestBookingToken(
  token: string,
  restaurantId: string,
  now = new Date(),
): boolean {
  const key = secret();
  if (!key || typeof token !== 'string' || !TEST_BOOKING_TOKEN_PATTERN.test(token)) return false;
  if (!UUID.test(restaurantId)) return false;
  const [data, mac] = token.split('.');
  const payload = Buffer.from(data, 'base64url');
  const signature = Buffer.from(mac, 'base64url');
  if (payload.length !== 20 || signature.length !== 32) return false;
  if (payload.toString('base64url') !== data || signature.toString('base64url') !== mac) {
    return false;
  }
  const expected = sign(payload, key);
  if (!timingSafeEqual(signature, expected)) return false;
  const tokenRestaurant = payload.subarray(0, 16);
  const wanted = Buffer.from(restaurantId.replace(/-/g, ''), 'hex');
  if (!timingSafeEqual(tokenRestaurant, wanted)) return false;
  return payload.readUInt32BE(16) > now.getTime() / 1000;
}

// Repli mémoire quand Redis est indisponible (même limite, par processus)
const fallbackStore = new Map<string, { count: number; expiresAt: number }>();

function fallbackIncr(key: string, ttlMs: number): number {
  const now = Date.now();
  const entry = fallbackStore.get(key);
  if (!entry || now > entry.expiresAt) {
    fallbackStore.set(key, { count: 1, expiresAt: now + ttlMs });
    return 1;
  }
  entry.count++;
  return entry.count;
}

/** Consomme une réservation test du quota (5 par restaurant sur 24 h). */
export async function consumeTestBookingQuota(restaurantId: string): Promise<boolean> {
  const key = `test-booking:quota:${restaurantId}`;
  try {
    const count = await redisCache.incr(key);
    // TTL -1 = clé sans expiration (un EXPIRE précédent a échoué) : on la remet,
    // sinon le quota bloquerait le restaurant pour toujours.
    if (count === 1 || (await redisCache.ttl(key)) === -1) {
      await redisCache.expire(key, QUOTA_TTL_SECONDS);
    }
    return count <= QUOTA_LIMIT;
  } catch (err) {
    alertFailOpen({ source: 'test_booking_quota', reason: 'consume_redis_down', err });
    return fallbackIncr(key, QUOTA_TTL_SECONDS * 1000) <= QUOTA_LIMIT;
  }
}
