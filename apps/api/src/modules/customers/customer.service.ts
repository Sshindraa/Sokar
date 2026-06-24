import { db } from '../../shared/db/client';
import { getCachedContext, setCachedContext, redisCache } from '../../shared/redis/client';

export interface CustomerContext {
  id: string;
  name: string | null;
  visitCount: number;
  isVip: boolean;
  specialOccasion: string | null;
  notes: string | null;
  lastCallAt: Date | null;
  partySizeTypical: number | null;
}

export class CustomerService {
  static async lookupOrCreate(
    restaurantId: string,
    phone: string,
    name?: string,
  ): Promise<CustomerContext> {
    const cacheKey = `customer:${restaurantId}:${phone}`;
    const cached = await getCachedContext(cacheKey);
    if (cached) return cached;

    const customer = await db.customer.upsert({
      where: { restaurantId_phone: { restaurantId, phone } },
      create: { restaurantId, phone, name: name ?? null, visitCount: 0 },
      update: name ? { name, lastSeenAt: new Date() } : { lastSeenAt: new Date() },
    });

    const ctx: CustomerContext = {
      id: customer.id,
      name: customer.name,
      visitCount: customer.visitCount,
      isVip: customer.isVip,
      specialOccasion: customer.specialOccasion,
      notes: customer.notes,
      lastCallAt: customer.lastCallAt,
      partySizeTypical:
        customer.partySizeTypical !== null ? Number(customer.partySizeTypical) : null,
    };

    await setCachedContext(cacheKey, ctx, 300);
    return ctx;
  }

  static async incrementVisit(restaurantId: string, phone: string): Promise<void> {
    await db.customer.updateMany({
      where: { restaurantId, phone },
      data: { visitCount: { increment: 1 }, lastSeenAt: new Date() },
    });
    await redisCache.del(`customer:${restaurantId}:${phone}`);
  }

  /**
   * Called on every inbound call (hangup or not). Cheap — touches only the
   * customer row and invalidates the 5-min lookup cache so the next call sees
   * the fresh lastCallAt.
   */
  static async recordCallActivity(
    restaurantId: string,
    phone: string,
    partySize: number | null,
  ): Promise<void> {
    const data: Record<string, unknown> = { lastCallAt: new Date() };
    if (partySize && partySize > 0) {
      // 70% recent weight, 30% prior — let pattern emerge over time without
      // overwriting the first few samples. Falls back to prior if no history.
      const existing = await db.customer.findUnique({
        where: { restaurantId_phone: { restaurantId, phone } },
        select: { partySizeTypical: true },
      });
      const prior = existing?.partySizeTypical ? Number(existing.partySizeTypical) : null;
      if (prior && prior > 0) {
        data.partySizeTypical = Math.round(0.7 * partySize + 0.3 * prior);
      } else {
        data.partySizeTypical = partySize;
      }
    }

    await db.customer.updateMany({
      where: { restaurantId, phone },
      data,
    });
    await redisCache.del(`customer:${restaurantId}:${phone}`);
  }

  static buildVipPromptExtra(customer: CustomerContext): string {
    if (!customer.name) return '';
    const lines: string[] = [`Le client s'appelle ${customer.name}.`];
    if (customer.visitCount > 0) lines.push(`C'est sa ${customer.visitCount + 1}e visite.`);
    if (customer.isVip) lines.push('⭐ Client VIP — sois particulièrement attentionné.');
    if (customer.specialOccasion) lines.push(`Occasion spéciale : ${customer.specialOccasion}.`);
    if (customer.notes) lines.push(`Note gérant : ${customer.notes}`);
    if (customer.partySizeTypical && customer.partySizeTypical > 0) {
      lines.push(`Taille de groupe habituelle : ${customer.partySizeTypical} pers.`);
    }
    return lines.join(' ');
  }

  /**
   * Returns a short French greeting fragment for a returning customer.
   * Empty string if we don't know the customer well enough (no name).
   * Used in the first utterance of returning VIPs.
   */
  static buildReturningGreeting(customer: CustomerContext): string {
    if (!customer.name) return '';
    if (customer.isVip) return `, content de vous revoir M. ${customer.name.split(' ')[0]}`;
    if (customer.visitCount >= 1) {
      return `, ravi de vous revoir ${customer.name.split(' ')[0]}`;
    }
    return '';
  }
}
