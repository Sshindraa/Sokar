import { describe, expect, it } from 'vitest';
import { evaluateUsageThresholds, usageAlertClaimKey } from '../usage-alerts.service';

describe('internal usage cost-watch thresholds', () => {
  it('converts voice seconds to minutes and emits each crossed milestone', () => {
    const alerts = evaluateUsageThresholds({
      usage: [
        { category: 'TELEPHONY_SECONDS', quantity: '5700' },
        { category: 'SMS_SEGMENTS', quantity: '20' },
      ],
      limits: { voiceMinutesMonthly: 100, smsMonthly: 20 },
    });

    expect(alerts).toEqual([
      {
        metric: 'voiceMinutes',
        threshold: 70,
        used: '95.000000',
        included: 100,
        percentage: '95.00',
        severity: 'warning',
      },
      {
        metric: 'voiceMinutes',
        threshold: 90,
        used: '95.000000',
        included: 100,
        percentage: '95.00',
        severity: 'warning',
      },
      {
        metric: 'smsSegments',
        threshold: 70,
        used: '20.000000',
        included: 20,
        percentage: '100.00',
        severity: 'warning',
      },
      {
        metric: 'smsSegments',
        threshold: 90,
        used: '20.000000',
        included: 20,
        percentage: '100.00',
        severity: 'warning',
      },
      {
        metric: 'smsSegments',
        threshold: 100,
        used: '20.000000',
        included: 20,
        percentage: '100.00',
        severity: 'critical',
      },
    ]);
  });

  it('reste silencieux quand aucun budget interne n’est configuré', () => {
    expect(
      evaluateUsageThresholds({
        usage: [{ category: 'TELEPHONY_SECONDS', quantity: '999999' }],
        limits: { voiceMinutesMonthly: null, smsMonthly: null },
      }),
    ).toEqual([]);
  });

  it('produit une clé stable par mois, restaurant, métrique et seuil', () => {
    expect(
      usageAlertClaimKey('2026-09', 'restaurant-1', {
        metric: 'voiceMinutes',
        threshold: 90,
      }),
    ).toBe('sokar:usage-alert:2026-09:restaurant-1:voiceMinutes:90');
  });
});
