import { describe, expect, it } from 'vitest';
import { buildUsageQuotaSnapshot } from '../usage-quota.service';

describe('usage projection compatibility shape', () => {
  it('converts telephony seconds to minutes and preserves configured limits', () => {
    const snapshot = buildUsageQuotaSnapshot(
      [
        { category: 'TELEPHONY_SECONDS', quantity: '3661' },
        { category: 'SMS_SEGMENTS', quantity: '12' },
      ],
      { voiceMinutesMonthly: 60, smsMonthly: 20 },
    );

    expect(snapshot).toEqual({
      voiceMinutes: {
        used: '61.016667',
        included: 60,
        remaining: '0.000000',
        state: 'EXCEEDED',
      },
      smsSegments: {
        used: '12.000000',
        included: 20,
        remaining: '8.000000',
        state: 'WITHIN_LIMIT',
      },
    });
  });

  it('keeps the legacy null-limit shape for the unlimited customer promise', () => {
    const snapshot = buildUsageQuotaSnapshot([{ category: 'TELEPHONY_SECONDS', quantity: '120' }], {
      voiceMinutesMonthly: null,
      smsMonthly: null,
    });

    expect(snapshot.voiceMinutes).toMatchObject({
      used: '2.000000',
      included: null,
      remaining: null,
      state: 'NOT_CONFIGURED',
    });
    expect(snapshot.smsSegments).toMatchObject({
      used: '0.000000',
      included: null,
      remaining: null,
      state: 'NOT_CONFIGURED',
    });
  });
});
