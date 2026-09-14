import { Prisma, UsageAdjustmentStatus, type UsageCategory } from '@prisma/client';
import { PLAN_PRICE_MAP } from '@sokar/config';
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

export type InternalMarginCostStatus = UsageCostStatus | 'NO_USAGE';

export interface InternalMarginReportRow {
  readonly restaurantId: string;
  readonly restaurantName: string | null;
  readonly plan: string | null;
  /** Price from the local commercial catalogue, never from Stripe state. */
  readonly catalogPriceEur: number | null;
  /** Approved, restaurant-scoped invoice corrections applied to the projection. */
  readonly approvedAdjustmentCostEur: string;
  readonly approvedAdjustmentCount: number;
  readonly estimatedCostEur: string;
  /** Estimated cost plus approved restaurant-scoped corrections. */
  readonly adjustedCostEur: string;
  readonly costStatus: InternalMarginCostStatus;
  readonly grossMarginEur: string | null;
  readonly grossMarginPercent: string | null;
  readonly categories: InternalUsageSummaryRow[];
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

function catalogPrice(plan: string | null): number | null {
  if (!plan) return null;
  const price = PLAN_PRICE_MAP[plan.toUpperCase()];
  return typeof price === 'number' ? price : null;
}

/**
 * Build an operator-only margin projection from the immutable usage feed.
 *
 * A margin is returned only when every event for the restaurant/category set
 * has a priced tariff and the plan exists in the local catalogue. This keeps
 * `0`/missing provider tariffs from looking like free usage or real revenue.
 */
export async function getInternalMarginReport(input: {
  monthKey: string;
  restaurantId?: string;
}): Promise<InternalMarginReportRow[]> {
  const { start, end } = monthBounds(input.monthKey);
  const [categories, approvedAdjustments, restaurants] = await Promise.all([
    getInternalUsageSummary(input),
    db.usageReconciliationAdjustment.findMany({
      where: {
        status: UsageAdjustmentStatus.APPROVED,
        // Do not prorate a multi-month correction silently. The operator must
        // split it into month-bounded adjustments before it affects a margin.
        periodStart: { gte: start, lt: end },
        periodEnd: { gt: start, lte: end },
        // A global correction has no safe restaurant allocation. It remains
        // visible in the operator queue until an explicitly scoped correction
        // is recorded, so it cannot distort any site's margin.
        restaurantId: input.restaurantId ?? { not: null },
      },
      select: { restaurantId: true, costDeltaEur: true },
    }),
    db.restaurant.findMany({
      where: input.restaurantId ? { id: input.restaurantId } : undefined,
      select: { id: true, name: true, plan: true },
      orderBy: { name: 'asc' },
    }),
  ]);
  const byRestaurant = new Map<string, InternalUsageSummaryRow[]>();
  for (const row of categories) {
    const bucket = byRestaurant.get(row.restaurantId) ?? [];
    bucket.push(row);
    byRestaurant.set(row.restaurantId, bucket);
  }

  const adjustmentsByRestaurant = new Map<string, { cost: Prisma.Decimal; count: number }>();
  for (const adjustment of approvedAdjustments) {
    if (!adjustment.restaurantId) continue;
    const current = adjustmentsByRestaurant.get(adjustment.restaurantId) ?? {
      cost: new Prisma.Decimal(0),
      count: 0,
    };
    current.cost = current.cost.add(adjustment.costDeltaEur);
    current.count += 1;
    adjustmentsByRestaurant.set(adjustment.restaurantId, current);
  }

  // Include restaurants with zero usage so the operator can distinguish
  // “no activity” from “not present in the report”. This also makes the
  // margin cockpit a complete monthly inventory instead of an event-only
  // view.
  const restaurantById = new Map(restaurants.map((restaurant) => [restaurant.id, restaurant]));
  const restaurantIds = new Set([
    ...restaurants.map((restaurant) => restaurant.id),
    ...byRestaurant.keys(),
    ...adjustmentsByRestaurant.keys(),
  ]);

  return [...restaurantIds].map((restaurantId) => {
    const rows = byRestaurant.get(restaurantId) ?? [];
    const restaurant = restaurantById.get(restaurantId);
    const estimatedCost = rows.reduce(
      (sum, row) => sum.add(new Prisma.Decimal(row.estimatedCostEur)),
      new Prisma.Decimal(0),
    );
    const adjustment = adjustmentsByRestaurant.get(restaurantId) ?? {
      cost: new Prisma.Decimal(0),
      count: 0,
    };
    const adjustedCost = estimatedCost.add(adjustment.cost);
    if (rows.length === 0) {
      return {
        restaurantId,
        restaurantName: restaurant?.name ?? null,
        plan: restaurant?.plan ?? null,
        catalogPriceEur: catalogPrice(restaurant?.plan ?? null),
        approvedAdjustmentCostEur: adjustment.cost.toFixed(6),
        approvedAdjustmentCount: adjustment.count,
        estimatedCostEur: '0.000000',
        adjustedCostEur: adjustedCost.toFixed(6),
        costStatus: 'NO_USAGE' as const,
        grossMarginEur: null,
        grossMarginPercent: null,
        categories: [],
      };
    }

    const first = rows[0]!;
    const allPriced = rows.every((row) => row.costStatus === 'PRICED');
    const anyPriced = rows.some((row) => row.costStatus === 'PRICED');
    const status: InternalMarginCostStatus = allPriced
      ? 'PRICED'
      : anyPriced
        ? 'MIXED'
        : 'UNPRICED';
    const price = catalogPrice(first.plan);
    const margin = allPriced && price !== null ? new Prisma.Decimal(price).sub(adjustedCost) : null;
    return {
      restaurantId,
      restaurantName: first.restaurantName ?? restaurant?.name ?? null,
      plan: first.plan ?? restaurant?.plan ?? null,
      catalogPriceEur: price,
      approvedAdjustmentCostEur: adjustment.cost.toFixed(6),
      approvedAdjustmentCount: adjustment.count,
      estimatedCostEur: estimatedCost.toFixed(6),
      adjustedCostEur: adjustedCost.toFixed(6),
      costStatus: status,
      grossMarginEur: margin?.toFixed(6) ?? null,
      grossMarginPercent: margin && price !== null ? margin.div(price).mul(100).toFixed(2) : null,
      categories: rows,
    };
  });
}
