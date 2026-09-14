import { Prisma } from '@prisma/client';
import type { PlanUsageLimits } from '@sokar/config';
import type { UsageQuantity } from './usage.types';

export const USAGE_ALERT_THRESHOLDS = [70, 90, 100] as const;
export type UsageAlertThreshold = (typeof USAGE_ALERT_THRESHOLDS)[number];
export type UsageAlertMetric = 'voiceMinutes' | 'smsSegments';

export interface UsageThresholdAlert {
  readonly metric: UsageAlertMetric;
  readonly threshold: UsageAlertThreshold;
  readonly used: string;
  readonly included: number;
  readonly percentage: string;
  readonly severity: 'warning' | 'critical';
}

function decimal(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function quantityFor(usage: UsageQuantity[], category: UsageQuantity['category']): Prisma.Decimal {
  return decimal(usage.find((item) => item.category === category)?.quantity ?? '0');
}

function evaluateMetric(
  metric: UsageAlertMetric,
  used: Prisma.Decimal,
  budget: number | null,
): UsageThresholdAlert[] {
  // A null budget is deliberately silent. Customer plans are unlimited; this
  // optional evaluator is only for an operator-defined cost watch and must
  // never become a customer-facing cap.
  if (budget === null || !Number.isFinite(budget) || budget <= 0) return [];

  const percentage = used.div(budget).mul(100);
  return USAGE_ALERT_THRESHOLDS.filter((threshold) => percentage.gte(threshold)).map(
    (threshold) => ({
      metric,
      threshold,
      used: used.toFixed(6),
      included: budget,
      percentage: percentage.toFixed(2),
      severity: threshold === 100 ? 'critical' : 'warning',
    }),
  );
}

/**
 * Returns operator cost-watch milestones currently crossed by one restaurant.
 *
 * The function is pure with respect to persistence: callers can run it from
 * a worker, a preview or a test without changing the ledger. The worker then
 * claims each returned milestone once for the UTC month. The supplied limits
 * are an internal budget input; they are never a customer entitlement.
 */
export function evaluateUsageThresholds(input: {
  usage: UsageQuantity[];
  limits: Pick<PlanUsageLimits, 'voiceMinutesMonthly' | 'smsMonthly'>;
}): UsageThresholdAlert[] {
  const voiceMinutes = quantityFor(input.usage, 'TELEPHONY_SECONDS').div(60);
  const smsSegments = quantityFor(input.usage, 'SMS_SEGMENTS');
  return [
    ...evaluateMetric('voiceMinutes', voiceMinutes, input.limits.voiceMinutesMonthly),
    ...evaluateMetric('smsSegments', smsSegments, input.limits.smsMonthly),
  ];
}

export function usageAlertClaimKey(
  monthKey: string,
  restaurantId: string,
  alert: Pick<UsageThresholdAlert, 'metric' | 'threshold'>,
): string {
  return `sokar:usage-alert:${monthKey}:${restaurantId}:${alert.metric}:${alert.threshold}`;
}
