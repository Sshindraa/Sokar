import { Prisma, type UsageCategory } from '@prisma/client';
import { db } from '../../shared/db/client';
import { recordUsageEvent } from './usage.service';
import type { RecordUsageInput } from './usage.types';

export type UsageCostStatus = 'PRICED' | 'UNPRICED';

export interface UsageTariffResolution {
  readonly estimatedCostEur: string;
  readonly pricePerUnit?: string;
  readonly costStatus: UsageCostStatus;
  readonly tariffId?: string;
  readonly tariffVersion?: number;
  readonly tariffSource?: string;
}

export interface ResolveUsageTariffInput {
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly occurredAt: Date;
  readonly quantity: string | number;
}

export type RecordPricedUsageInput = Omit<RecordUsageInput, 'estimatedCostEur'>;

function normalizeDimension(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolve the tariff that was effective when usage occurred. Rates are never
 * inferred in code: no matching row deliberately returns UNPRICED/0.
 */
export async function resolveUsageTariff(
  input: ResolveUsageTariffInput,
): Promise<UsageTariffResolution> {
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new Error('occurredAt must be a valid date');
  }

  const tariff = await db.usageTariff.findFirst({
    where: {
      category: input.category,
      provider: normalizeDimension(input.provider),
      unit: normalizeDimension(input.unit),
      currency: 'EUR',
      effectiveFrom: { lte: input.occurredAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: input.occurredAt } }],
    },
    orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
  });

  if (!tariff) {
    return { estimatedCostEur: '0.000000', costStatus: 'UNPRICED' };
  }

  const price = new Prisma.Decimal(tariff.pricePerUnit);
  if (!price.isFinite() || price.isNegative()) {
    throw new Error(`Invalid usage tariff ${tariff.id}`);
  }

  return {
    estimatedCostEur: calculateUsageCost(input.quantity, price.toString()),
    pricePerUnit: price.toFixed(9),
    costStatus: 'PRICED',
    tariffId: tariff.id,
    tariffVersion: tariff.version,
    tariffSource: tariff.source,
  };
}

/**
 * Price a quantity with the effective tariff, then append it to the immutable
 * usage ledger. Keeping the lookup and recorder together prevents provider
 * collectors from silently bypassing the tariff status metadata.
 */
export async function recordPricedUsageEvent(
  input: RecordPricedUsageInput,
): Promise<Awaited<ReturnType<typeof recordUsageEvent>>> {
  const provider = normalizeDimension(input.provider);
  const unit = normalizeDimension(input.unit);
  const resolution = await resolveUsageTariff({
    category: input.category,
    provider,
    unit,
    occurredAt: input.occurredAt,
    quantity: input.quantity,
  });

  return recordUsageEvent({
    ...input,
    provider,
    unit,
    estimatedCostEur: resolution.estimatedCostEur,
    metadata: {
      ...(input.metadata ?? {}),
      costStatus: resolution.costStatus,
      ...(resolution.tariffId ? { tariffId: resolution.tariffId } : {}),
      ...(resolution.tariffVersion !== undefined
        ? { tariffVersion: resolution.tariffVersion }
        : {}),
      ...(resolution.tariffSource ? { tariffSource: resolution.tariffSource } : {}),
    },
  });
}

/** Compute the cost for a known rate without writing a ledger event. */
export function calculateUsageCost(
  quantity: string | number,
  pricePerUnit: string | number,
): string {
  const amount = new Prisma.Decimal(quantity);
  const price = new Prisma.Decimal(pricePerUnit);
  if (!amount.isFinite() || amount.isNegative()) throw new Error('quantity must be non-negative');
  if (!price.isFinite() || price.isNegative()) {
    throw new Error('pricePerUnit must be non-negative');
  }
  return amount.mul(price).toFixed(6);
}
