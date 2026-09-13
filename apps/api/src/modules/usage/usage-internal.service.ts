import { Prisma, type UsageCategory } from '@prisma/client';
import { db } from '../../shared/db/client';
import { monthBounds } from './usage.service';

export type UsageCostStatus = 'PRICED' | 'UNPRICED' | 'MIXED';

export interface InternalUsageSummaryRow {
  readonly restaurantId: string;
  readonly restaurantName: string | null;
  readonly plan: string | null;
  readonly category: UsageCategory;
  readonly quantity: string;
  readonly estimatedCostEur: string;
  readonly costStatus: UsageCostStatus;
  readonly pricedEvents: number;
  readonly unpricedEvents: number;
}

function isPricedMetadata(metadata: unknown, estimatedCost: Prisma.Decimal): boolean {
  if (metadata && typeof metadata === 'object') {
    const status = (metadata as Record<string, unknown>).costStatus;
    if (status === 'PRICED') return true;
    if (status === 'UNPRICED') return false;
  }
  return !estimatedCost.isZero();
}

/**
 * Aggregate internal usage and margin inputs from immutable events. This
 * endpoint is intentionally separate from the customer usage projection and
 * must only be exposed behind the ops token.
 */
export async function getInternalUsageSummary(input: {
  monthKey: string;
  restaurantId?: string;
}): Promise<InternalUsageSummaryRow[]> {
  const { start, end } = monthBounds(input.monthKey);
  const events = await db.usageEvent.findMany({
    where: {
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      occurredAt: { gte: start, lt: end },
    },
    select: {
      restaurantId: true,
      category: true,
      quantity: true,
      estimatedCost: true,
      metadata: true,
    },
    orderBy: [{ restaurantId: 'asc' }, { category: 'asc' }],
  });

  const grouped = new Map<
    string,
    {
      restaurantId: string;
      category: UsageCategory;
      quantity: Prisma.Decimal;
      estimatedCost: Prisma.Decimal;
      pricedEvents: number;
      unpricedEvents: number;
    }
  >();
  for (const event of events) {
    const key = `${event.restaurantId}:${event.category}`;
    const current = grouped.get(key) ?? {
      restaurantId: event.restaurantId,
      category: event.category,
      quantity: new Prisma.Decimal(0),
      estimatedCost: new Prisma.Decimal(0),
      pricedEvents: 0,
      unpricedEvents: 0,
    };
    current.quantity = current.quantity.add(event.quantity);
    current.estimatedCost = current.estimatedCost.add(event.estimatedCost);
    if (isPricedMetadata(event.metadata, event.estimatedCost)) current.pricedEvents += 1;
    else current.unpricedEvents += 1;
    grouped.set(key, current);
  }

  const restaurantIds = [...new Set([...grouped.values()].map((row) => row.restaurantId))];
  const restaurants = restaurantIds.length
    ? await db.restaurant.findMany({
        where: { id: { in: restaurantIds } },
        select: { id: true, name: true, plan: true },
      })
    : [];
  const restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));

  return [...grouped.values()].map((row) => ({
    restaurantId: row.restaurantId,
    restaurantName: restaurantById.get(row.restaurantId)?.name ?? null,
    plan: restaurantById.get(row.restaurantId)?.plan ?? null,
    category: row.category,
    quantity: row.quantity.toFixed(6),
    estimatedCostEur: row.estimatedCost.toFixed(6),
    costStatus: row.pricedEvents === 0 ? 'UNPRICED' : row.unpricedEvents === 0 ? 'PRICED' : 'MIXED',
    pricedEvents: row.pricedEvents,
    unpricedEvents: row.unpricedEvents,
  }));
}
