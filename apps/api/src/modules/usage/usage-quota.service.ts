import { Prisma } from '@prisma/client';
import type { PlanUsageLimits } from '@sokar/config';
import type { UsageQuantity } from './usage.types';

export type UsageQuotaState = 'NOT_CONFIGURED' | 'WITHIN_LIMIT' | 'EXCEEDED';

export interface UsageQuotaSnapshot {
  readonly voiceMinutes: {
    readonly used: string;
    readonly included: number | null;
    readonly remaining: string | null;
    readonly state: UsageQuotaState;
  };
  readonly smsSegments: {
    readonly used: string;
    readonly included: number | null;
    readonly remaining: string | null;
    readonly state: UsageQuotaState;
  };
}

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function quantityFor(usage: UsageQuantity[], category: UsageQuantity['category']): Prisma.Decimal {
  const row = usage.find((item) => item.category === category);
  return decimal(row?.quantity ?? '0');
}

function quota(
  used: Prisma.Decimal,
  included: number | null,
  divisor = 1,
): UsageQuotaSnapshot['voiceMinutes'] {
  const normalizedUsed = used.div(divisor);
  if (included === null) {
    return {
      used: normalizedUsed.toFixed(6),
      included: null,
      remaining: null,
      state: 'NOT_CONFIGURED',
    };
  }

  const remaining = new Prisma.Decimal(included).sub(normalizedUsed);
  return {
    used: normalizedUsed.toFixed(6),
    included,
    remaining: remaining.isNegative() ? '0.000000' : remaining.toFixed(6),
    state: remaining.isNegative() ? 'EXCEEDED' : 'WITHIN_LIMIT',
  };
}

/**
 * Convert immutable usage quantities into the legacy customer-facing shape.
 * A null limit means that Sokar applies no customer quota. The API keeps the
 * `NOT_CONFIGURED` wire state for compatibility with existing consumers, but
 * the public route also exposes `customerUsagePolicy=UNLIMITED` and never
 * enforces a cap from this projection.
 */
export function buildUsageQuotaSnapshot(
  usage: UsageQuantity[],
  limits: Pick<PlanUsageLimits, 'voiceMinutesMonthly' | 'smsMonthly'>,
): UsageQuotaSnapshot {
  return {
    voiceMinutes: quota(quantityFor(usage, 'TELEPHONY_SECONDS'), limits.voiceMinutesMonthly, 60),
    smsSegments: quota(quantityFor(usage, 'SMS_SEGMENTS'), limits.smsMonthly),
  };
}
