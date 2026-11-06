import { createHash } from 'node:crypto';

import { alertFailOpen } from '../../../shared/observability/alerts';
import { redisCache } from '../../../shared/redis/client';

/** Holds actifs qu'un même client peut poser sur un créneau, dans la fenêtre. */
export const SLOT_HOLD_LIMIT = 3;
const WINDOW_SECONDS = 15 * 60;

type FallbackEntry = { count: number; expiresAt: number };
const fallbackStore = new Map<string, FallbackEntry>();

function fallbackIncr(key: string): number {
  const now = Date.now();
  const entry = fallbackStore.get(key);
  if (!entry || now > entry.expiresAt) {
    fallbackStore.set(key, { count: 1, expiresAt: now + WINDOW_SECONDS * 1000 });
    return 1;
  }
  entry.count++;
  return entry.count;
}

/**
 * Plafond par client et par créneau : un même client ne peut pas occuper toutes les tables d'un
 * créneau en posant des holds en boucle. Le client est identifié par son IP (hachée), jamais par un
 * identifiant qu'il choisit lui-même.
 */
export async function canHoldSlot(args: {
  restaurantId: string;
  slotStart: Date;
  clientIp: string;
}): Promise<boolean> {
  const clientHash = createHash('sha256').update(args.clientIp).digest('hex').slice(0, 32);
  const key = `agentic:slot-hold:${args.restaurantId}:${args.slotStart.toISOString()}:${clientHash}`;
  try {
    const count = await redisCache.incr(key);
    if (count === 1) await redisCache.expire(key, WINDOW_SECONDS);
    return count <= SLOT_HOLD_LIMIT;
  } catch (err) {
    alertFailOpen({ source: 'hold_slot_limit', reason: 'redis_down', err });
    return fallbackIncr(key) <= SLOT_HOLD_LIMIT;
  }
}
