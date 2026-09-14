import { describe, expect, it } from 'vitest';
import { getInternalUsageAlertBudgets } from '../usage-alert-budget.service';

describe('internal usage alert budgets', () => {
  it('reads positive operator budgets without touching customer entitlements', () => {
    expect(
      getInternalUsageAlertBudgets({
        USAGE_ALERT_VOICE_BUDGET_MINUTES: '1000',
        USAGE_ALERT_SMS_BUDGET_SEGMENTS: '500',
      }),
    ).toEqual({ voiceMinutesMonthly: 1000, smsMonthly: 500 });
  });

  it('silently disables invalid or absent budgets', () => {
    expect(
      getInternalUsageAlertBudgets({
        USAGE_ALERT_VOICE_BUDGET_MINUTES: '0',
        USAGE_ALERT_SMS_BUDGET_SEGMENTS: 'not-a-number',
      }),
    ).toEqual({ voiceMinutesMonthly: null, smsMonthly: null });
  });
});
