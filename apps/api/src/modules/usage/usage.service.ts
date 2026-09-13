import { Prisma, type UsageCategory, type UsageEvent } from '@prisma/client';
import { db } from '../../shared/db/client';
import type { RecordUsageInput, UsageQuantity } from './usage.types';

const MONTH_KEY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export class UsageEventConflictError extends Error {
  readonly code = 'USAGE_EVENT_KEY_CONFLICT';

  constructor(readonly sourceEventKey: string) {
    super(`Usage event key already exists with different data: ${sourceEventKey}`);
    this.name = 'UsageEventConflictError';
  }
}

export class UsageInputError extends Error {
  readonly code = 'USAGE_INPUT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'UsageInputError';
  }
}

function decimal(value: string | number, field: string): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = new Prisma.Decimal(value);
  } catch {
    throw new UsageInputError(`${field} must be a decimal value`);
  }
  if (!parsed.isFinite() || parsed.isNegative()) {
    throw new UsageInputError(`${field} must be finite and non-negative`);
  }
  return parsed;
}

function validateText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new UsageInputError(`${field} must contain between 1 and ${maxLength} characters`);
  }
  return normalized;
}

function sameReplay(
  existing: UsageEvent,
  input: RecordUsageInput,
  quantity: Prisma.Decimal,
  estimatedCost: Prisma.Decimal,
): boolean {
  return (
    existing.restaurantId === input.restaurantId &&
    existing.accountId === (input.accountId ?? null) &&
    existing.category === input.category &&
    existing.provider === input.provider.trim() &&
    existing.quantity.equals(quantity) &&
    existing.unit === input.unit.trim() &&
    existing.estimatedCost.equals(estimatedCost) &&
    existing.currency === 'EUR' &&
    existing.sourceType === input.sourceType.trim() &&
    existing.sourceId === input.sourceId.trim()
  );
}

/**
 * Append one immutable usage event. Replaying the same source key and payload
 * returns the existing row. Reusing the key for different usage is rejected.
 */
export async function recordUsageEvent(
  input: RecordUsageInput,
): Promise<{ event: UsageEvent; created: boolean }> {
  const quantity = decimal(input.quantity, 'quantity');
  const estimatedCost = decimal(input.estimatedCostEur, 'estimatedCostEur');
  const provider = validateText(input.provider, 'provider', 64);
  const unit = validateText(input.unit, 'unit', 32);
  const sourceType = validateText(input.sourceType, 'sourceType', 64);
  const sourceId = validateText(input.sourceId, 'sourceId', 191);
  const sourceEventKey = validateText(input.sourceEventKey, 'sourceEventKey', 255);
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new UsageInputError('occurredAt must be a valid date');
  }

  const normalizedInput = { ...input, provider, unit, sourceType, sourceId, sourceEventKey };
  const existing = await db.usageEvent.findUnique({ where: { sourceEventKey } });
  if (existing) {
    if (!sameReplay(existing, normalizedInput, quantity, estimatedCost)) {
      throw new UsageEventConflictError(sourceEventKey);
    }
    return { event: existing, created: false };
  }

  try {
    const event = await db.usageEvent.create({
      data: {
        restaurantId: input.restaurantId,
        accountId: input.accountId ?? null,
        category: input.category,
        provider,
        quantity,
        unit,
        estimatedCost,
        currency: 'EUR',
        sourceType,
        sourceId,
        sourceEventKey,
        occurredAt: input.occurredAt,
        metadata: input.metadata ?? {},
      },
    });
    return { event, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }
    const raced = await db.usageEvent.findUnique({ where: { sourceEventKey } });
    if (!raced || !sameReplay(raced, normalizedInput, quantity, estimatedCost)) {
      throw new UsageEventConflictError(sourceEventKey);
    }
    return { event: raced, created: false };
  }
}

export function monthBounds(monthKey: string): { start: Date; end: Date } {
  if (!MONTH_KEY_PATTERN.test(monthKey)) throw new UsageInputError('month must use YYYY-MM');
  const [year, month] = monthKey.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function previousMonthKey(now = new Date()): string {
  const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return currentMonthKey(previous);
}

export async function getCurrentUsage(
  restaurantId: string,
  monthKey = currentMonthKey(),
): Promise<UsageQuantity[]> {
  const { start, end } = monthBounds(monthKey);
  const rows = await db.usageEvent.groupBy({
    by: ['category'],
    where: { restaurantId, occurredAt: { gte: start, lt: end } },
    _sum: { quantity: true },
    orderBy: { category: 'asc' },
  });
  return rows.map((row) => ({
    category: row.category,
    quantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toFixed(6),
  }));
}

export async function getUsageHistory(
  restaurantId: string,
  fromMonth: string,
  toMonth: string,
): Promise<Array<{ month: string; categories: UsageQuantity[] }>> {
  monthBounds(fromMonth);
  monthBounds(toMonth);
  if (fromMonth > toMonth) throw new UsageInputError('from must be before or equal to to');
  const fromIndex = Number(fromMonth.slice(0, 4)) * 12 + Number(fromMonth.slice(5, 7));
  const toIndex = Number(toMonth.slice(0, 4)) * 12 + Number(toMonth.slice(5, 7));
  if (toIndex - fromIndex >= 24) throw new UsageInputError('history is limited to 24 months');

  const rows = await db.usageMonthlyRollup.findMany({
    where: { restaurantId, monthKey: { gte: fromMonth, lte: toMonth } },
    orderBy: [{ monthKey: 'asc' }, { category: 'asc' }],
    select: { monthKey: true, category: true, quantity: true },
  });
  const months = new Map<string, UsageQuantity[]>();
  for (const row of rows) {
    const categories = months.get(row.monthKey) ?? [];
    categories.push({ category: row.category, quantity: row.quantity.toFixed(6) });
    months.set(row.monthKey, categories);
  }
  return [...months].map(([month, categories]) => ({ month, categories }));
}

export async function rebuildMonthlyRollups(restaurantId: string, monthKey: string): Promise<void> {
  const { start, end } = monthBounds(monthKey);
  const grouped = await db.usageEvent.groupBy({
    by: ['category'],
    where: { restaurantId, occurredAt: { gte: start, lt: end } },
    _sum: { quantity: true, estimatedCost: true },
  });

  await db.$transaction(async (tx) => {
    await tx.usageMonthlyRollup.deleteMany({ where: { restaurantId, monthKey } });
    for (const row of grouped) {
      await tx.usageMonthlyRollup.create({
        data: {
          restaurantId,
          monthKey,
          category: row.category as UsageCategory,
          quantity: row._sum.quantity ?? new Prisma.Decimal(0),
          estimatedCost: row._sum.estimatedCost ?? new Prisma.Decimal(0),
        },
      });
    }
  });
}
