import { db }                               from '../../shared/db/client';
import { getCachedContext, setCachedContext, redisCache } from '../../shared/redis/client';
import * as Sentry                           from '@sentry/node';
import { INTERNAL_CALL_ALERT_THRESHOLD, CIRCUIT_BREAKER_HOURLY_LIMIT, REDIS_CTX_TTL_SECONDS } from '@sokar/config';

function getCurrentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function getHourKey() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]
    .map(n => String(n).padStart(2, '0')).join('-');
}

export class RestaurantService {

  static async loadContext(phoneNumberId: string) {
    const cacheKey = `phone:${phoneNumberId}`;
    const cached   = await getCachedContext(cacheKey);
    if (cached) return cached;
    const restaurant = await db.restaurant.findUniqueOrThrow({
      where:   { phoneNumber: phoneNumberId },
      include: { personality: true },
    });
    await setCachedContext(cacheKey, restaurant, REDIS_CTX_TTL_SECONDS);
    return restaurant;
  }

  static async checkMarginHealth(restaurantId: string): Promise<boolean> {
    const monthKey = getCurrentMonthKey();
    const countKey = `infra:calls:${restaurantId}:${monthKey}`;
    const count    = await redisCache.incr(countKey);
    if (count === 1) await redisCache.expire(countKey, 33 * 24 * 3600);

    if (count > INTERNAL_CALL_ALERT_THRESHOLD) {
      Sentry.captureMessage(`[MARGIN] Restaurant ${restaurantId} atteint ${count} appels ce mois`, {
        level: 'warning', tags: { restaurantId, monthKey },
      });
    }

    const hourKey   = `infra:calls:${restaurantId}:${getHourKey()}`;
    const hourCount = await redisCache.incr(hourKey);
    if (hourCount === 1) await redisCache.expire(hourKey, 3600);

    if (hourCount > CIRCUIT_BREAKER_HOURLY_LIMIT) {
      Sentry.captureMessage(`[CIRCUIT_BREAKER] Restaurant ${restaurantId}: ${hourCount} appels en 1h`, {
        level: 'error',
      });
      return false;
    }
    return true;
  }

  static isOpen(ctx: any, date: string, time: string): boolean {
    const dayMap = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const d      = new Date(`${date}T${time}`);
    const slot   = (ctx.openingHours as any)[dayMap[d.getDay()]];
    if (!slot) return false;
    const [oh, om] = slot.open.split(':').map(Number);
    const [ch, cm] = slot.close.split(':').map(Number);
    const mins     = d.getHours() * 60 + d.getMinutes();
    return mins >= (oh * 60 + om) && mins < (ch * 60 + cm);
  }
}
