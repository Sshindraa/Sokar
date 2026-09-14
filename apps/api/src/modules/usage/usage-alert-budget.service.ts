export interface InternalUsageAlertBudgets {
  readonly voiceMinutesMonthly: number | null;
  readonly smsMonthly: number | null;
}

function positiveNumber(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Read optional operator-only watch budgets from the process environment.
 * These values are deliberately separate from plan entitlements: a budget can
 * trigger an internal cost-watch message, but it can never block a customer.
 */
export function getInternalUsageAlertBudgets(
  environment: NodeJS.ProcessEnv = process.env,
): InternalUsageAlertBudgets {
  return {
    voiceMinutesMonthly: positiveNumber(environment.USAGE_ALERT_VOICE_BUDGET_MINUTES),
    smsMonthly: positiveNumber(environment.USAGE_ALERT_SMS_BUDGET_SEGMENTS),
  };
}
