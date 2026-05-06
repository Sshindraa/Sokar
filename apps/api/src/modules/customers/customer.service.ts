import { db } from '../../shared/db/client';
import { getCachedContext, setCachedContext, redisCache } from '../../shared/redis/client';

export interface CustomerContext {
  id:              string;
  name:            string | null;
  visitCount:      number;
  isVip:           boolean;
  specialOccasion: string | null;
  notes:           string | null;
}

export class CustomerService {

  static async lookupOrCreate(
    restaurantId: string,
    phone: string,
    name?: string,
  ): Promise<CustomerContext> {
    const cacheKey = `customer:${restaurantId}:${phone}`;
    const cached   = await getCachedContext(cacheKey);
    if (cached) return cached;

    const customer = await db.customer.upsert({
      where:  { restaurantId_phone: { restaurantId, phone } },
      create: { restaurantId, phone, name: name ?? null, visitCount: 0 },
      update: name ? { name, lastSeenAt: new Date() } : { lastSeenAt: new Date() },
    });

    const ctx: CustomerContext = {
      id:              customer.id,
      name:            customer.name,
      visitCount:      customer.visitCount,
      isVip:           customer.isVip,
      specialOccasion: customer.specialOccasion,
      notes:           customer.notes,
    };

    await setCachedContext(cacheKey, ctx, 300);
    return ctx;
  }

  static async incrementVisit(restaurantId: string, phone: string): Promise<void> {
    await db.customer.updateMany({
      where: { restaurantId, phone },
      data:  { visitCount: { increment: 1 }, lastSeenAt: new Date() },
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
    return lines.join(' ');
  }
}
