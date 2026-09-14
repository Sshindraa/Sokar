import { createHash } from 'node:crypto';
import {
  Prisma,
  UsageAdjustmentStatus,
  UsageCategory,
  type PrismaClient,
  type UsageReconciliationAdjustment,
} from '@prisma/client';
import { db } from '../../shared/db/client';

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SIGNED_DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

type AdjustmentDb = Pick<PrismaClient, 'usageReconciliationAdjustment'>;

export interface RecordUsageAdjustmentInput {
  readonly reportHash: string;
  /** A vault path, invoice identifier or other bounded evidence reference. */
  readonly evidenceRef: string;
  /** `global` or `restaurant:<id>`; this prevents an accidental cross-tenant write. */
  readonly scopeKey: string;
  readonly restaurantId?: string | null;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly unit: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly quantityDelta: string | number;
  readonly costDeltaEur: string | number;
  readonly reason: string;
  /** SHA-256 of the authenticated operator identifier. */
  readonly createdByHash: string;
}

export interface DecideUsageAdjustmentInput {
  readonly id: string;
  readonly status: Extract<UsageAdjustmentStatus, 'APPROVED' | 'REJECTED'>;
  readonly reason: string;
  /** SHA-256 of the authenticated operator identifier. */
  readonly decidedByHash: string;
}

export class UsageAdjustmentInputError extends Error {
  readonly code = 'USAGE_ADJUSTMENT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'UsageAdjustmentInputError';
  }
}

export class UsageAdjustmentConflictError extends Error {
  readonly code = 'USAGE_ADJUSTMENT_CONFLICT';

  constructor(readonly idempotencyKey: string) {
    super(`Usage adjustment already exists with different data: ${idempotencyKey}`);
    this.name = 'UsageAdjustmentConflictError';
  }
}

export class UsageAdjustmentNotFoundError extends Error {
  readonly code = 'USAGE_ADJUSTMENT_NOT_FOUND';

  constructor(readonly id: string) {
    super(`Usage adjustment not found: ${id}`);
    this.name = 'UsageAdjustmentNotFoundError';
  }
}

export class UsageAdjustmentStateError extends Error {
  readonly code = 'USAGE_ADJUSTMENT_STATE_CONFLICT';

  constructor(
    readonly id: string,
    readonly status: UsageAdjustmentStatus,
  ) {
    super(`Usage adjustment ${id} is already ${status}`);
    this.name = 'UsageAdjustmentStateError';
  }
}

function text(value: unknown, field: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!normalized || normalized.length > maxLength) {
    throw new UsageAdjustmentInputError(
      `${field} must contain between 1 and ${maxLength} characters`,
    );
  }
  return normalized;
}

function hash(value: string): string {
  const normalized = text(value, 'hash', 64).toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) {
    throw new UsageAdjustmentInputError('hash must be a lowercase or uppercase SHA-256 value');
  }
  return normalized;
}

function decimal(value: string | number, field: string): Prisma.Decimal {
  const raw = typeof value === 'number' ? String(value) : value.trim();
  if (!SIGNED_DECIMAL_PATTERN.test(raw)) {
    throw new UsageAdjustmentInputError(`${field} must be a signed decimal value`);
  }
  const unsigned = raw.startsWith('-') ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  if (whole.length + fraction.length > 18 || fraction.length > 6) {
    throw new UsageAdjustmentInputError(`${field} exceeds DECIMAL(18,6)`);
  }
  const parsed = new Prisma.Decimal(raw);
  if (!parsed.isFinite()) {
    throw new UsageAdjustmentInputError(`${field} must be finite`);
  }
  return parsed;
}

function validDate(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new UsageAdjustmentInputError(`${field} must be a valid date`);
  }
  return new Date(value.getTime());
}

function category(value: UsageCategory): UsageCategory {
  if (!Object.values(UsageCategory).includes(value)) {
    throw new UsageAdjustmentInputError(`Unknown usage category: ${String(value)}`);
  }
  return value;
}

function scope(
  value: string,
  restaurantId: string | null | undefined,
): {
  scopeKey: string;
  restaurantId: string | null;
} {
  const scopeKey = text(value, 'scopeKey', 191);
  const normalizedRestaurantId = restaurantId ? text(restaurantId, 'restaurantId', 128) : null;
  if (scopeKey === 'global') {
    if (normalizedRestaurantId) {
      throw new UsageAdjustmentInputError('global scope cannot include restaurantId');
    }
    return { scopeKey, restaurantId: null };
  }
  if (!scopeKey.startsWith('restaurant:')) {
    throw new UsageAdjustmentInputError('scopeKey must be global or restaurant:<id>');
  }
  const scopeRestaurantId = scopeKey.slice('restaurant:'.length).trim();
  if (
    !scopeRestaurantId ||
    !normalizedRestaurantId ||
    scopeRestaurantId !== normalizedRestaurantId
  ) {
    throw new UsageAdjustmentInputError(
      'scopeKey and restaurantId must identify the same restaurant',
    );
  }
  return { scopeKey: `restaurant:${scopeRestaurantId}`, restaurantId: normalizedRestaurantId };
}

function adjustmentIdempotencyKey(input: {
  reportHash: string;
  scopeKey: string;
  category: UsageCategory;
  provider: string;
  unit: string;
  periodStart: Date;
  periodEnd: Date;
}): string {
  return createHash('sha256')
    .update(
      [
        input.reportHash,
        input.scopeKey,
        input.category,
        input.provider,
        input.unit,
        input.periodStart.toISOString(),
        input.periodEnd.toISOString(),
      ].join('|'),
    )
    .digest('hex');
}

function sameAdjustment(
  existing: UsageReconciliationAdjustment,
  input: {
    idempotencyKey: string;
    reportHash: string;
    evidenceRef: string;
    scopeKey: string;
    restaurantId: string | null;
    category: UsageCategory;
    provider: string;
    unit: string;
    periodStart: Date;
    periodEnd: Date;
    quantityDelta: Prisma.Decimal;
    costDeltaEur: Prisma.Decimal;
    reason: string;
  },
): boolean {
  return (
    existing.idempotencyKey === input.idempotencyKey &&
    existing.reportHash === input.reportHash &&
    existing.evidenceRef === input.evidenceRef &&
    existing.scopeKey === input.scopeKey &&
    existing.restaurantId === input.restaurantId &&
    existing.category === input.category &&
    existing.provider === input.provider &&
    existing.unit === input.unit &&
    existing.periodStart.getTime() === input.periodStart.getTime() &&
    existing.periodEnd.getTime() === input.periodEnd.getTime() &&
    existing.quantityDelta.equals(input.quantityDelta) &&
    existing.costDeltaEur.equals(input.costDeltaEur) &&
    existing.reason === input.reason
  );
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Record a reviewed difference without touching the immutable usage ledger.
 * Replaying the same report/dimension/period returns the existing adjustment;
 * changing the evidence or delta under that key is rejected.
 */
export async function recordUsageAdjustment(
  input: RecordUsageAdjustmentInput,
  client: AdjustmentDb = db,
): Promise<{ adjustment: UsageReconciliationAdjustment; created: boolean }> {
  const reportHash = hash(input.reportHash);
  const evidenceRef = text(input.evidenceRef, 'evidenceRef', 191);
  const scoped = scope(input.scopeKey, input.restaurantId);
  const normalizedCategory = category(input.category);
  const provider = text(input.provider, 'provider', 64).toLowerCase();
  const unit = text(input.unit, 'unit', 32).toLowerCase();
  const periodStart = validDate(input.periodStart, 'periodStart');
  const periodEnd = validDate(input.periodEnd, 'periodEnd');
  if (periodEnd <= periodStart) {
    throw new UsageAdjustmentInputError('periodEnd must be later than periodStart');
  }
  const quantityDelta = decimal(input.quantityDelta, 'quantityDelta');
  const costDeltaEur = decimal(input.costDeltaEur, 'costDeltaEur');
  if (quantityDelta.isZero() && costDeltaEur.isZero()) {
    throw new UsageAdjustmentInputError('quantityDelta or costDeltaEur must be non-zero');
  }
  const reason = text(input.reason, 'reason', 512);
  const createdByHash = hash(input.createdByHash);
  const idempotencyKey = adjustmentIdempotencyKey({
    reportHash,
    scopeKey: scoped.scopeKey,
    category: normalizedCategory,
    provider,
    unit,
    periodStart,
    periodEnd,
  });
  const normalized = {
    idempotencyKey,
    reportHash,
    evidenceRef,
    scopeKey: scoped.scopeKey,
    restaurantId: scoped.restaurantId,
    category: normalizedCategory,
    provider,
    unit,
    periodStart,
    periodEnd,
    quantityDelta,
    costDeltaEur,
    reason,
  };

  const existing = await client.usageReconciliationAdjustment.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    if (!sameAdjustment(existing, normalized)) {
      throw new UsageAdjustmentConflictError(idempotencyKey);
    }
    return { adjustment: existing, created: false };
  }

  try {
    const adjustment = await client.usageReconciliationAdjustment.create({
      data: {
        ...normalized,
        status: UsageAdjustmentStatus.OPEN,
        createdByHash,
      },
    });
    return { adjustment, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await client.usageReconciliationAdjustment.findUnique({
      where: { idempotencyKey },
    });
    if (!raced || !sameAdjustment(raced, normalized)) {
      throw new UsageAdjustmentConflictError(idempotencyKey);
    }
    return { adjustment: raced, created: false };
  }
}

/** Approve or reject an open adjustment with an atomic status predicate. */
export async function decideUsageAdjustment(
  input: DecideUsageAdjustmentInput,
  client: AdjustmentDb = db,
): Promise<UsageReconciliationAdjustment> {
  const id = text(input.id, 'id', 128);
  const reason = text(input.reason, 'reason', 512);
  const decidedByHash = hash(input.decidedByHash);
  const current = await client.usageReconciliationAdjustment.findUnique({ where: { id } });
  if (!current) throw new UsageAdjustmentNotFoundError(id);
  if (current.status !== UsageAdjustmentStatus.OPEN) {
    if (current.status === input.status && current.decisionReason === reason) return current;
    throw new UsageAdjustmentStateError(id, current.status);
  }

  const updated = await client.usageReconciliationAdjustment.updateMany({
    where: { id, status: UsageAdjustmentStatus.OPEN },
    data: {
      status: input.status,
      decisionReason: reason,
      decidedByHash,
      decidedAt: new Date(),
    },
  });
  if (updated.count === 1) {
    const decided = await client.usageReconciliationAdjustment.findUnique({ where: { id } });
    if (decided) return decided;
  }

  const raced = await client.usageReconciliationAdjustment.findUnique({ where: { id } });
  if (!raced) throw new UsageAdjustmentNotFoundError(id);
  if (raced.status === input.status && raced.decisionReason === reason) return raced;
  throw new UsageAdjustmentStateError(id, raced.status);
}

export { adjustmentIdempotencyKey };
