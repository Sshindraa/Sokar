import { describe, expect, it } from 'vitest';
import {
  buildDailyReportJobId,
  buildReconciliationJobId,
  buildSmsJobId,
  buildTelnyxWebhookJobId,
  defaultReliableJobOptions,
  highPriorityWebhookJobOptions,
} from '../job-options';

describe('BullMQ reliable job options', () => {
  it('keeps failed jobs for dead-letter inspection and retries with exponential backoff', () => {
    expect(defaultReliableJobOptions).toMatchObject({
      attempts: 5,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnFail: false,
    });
  });

  it('gives Telnyx webhook jobs more retry budget than default jobs', () => {
    expect(highPriorityWebhookJobOptions.attempts).toBe(8);
    expect(highPriorityWebhookJobOptions.backoff).toEqual({ type: 'exponential', delay: 2000 });
    expect(highPriorityWebhookJobOptions.removeOnFail).toBe(false);
  });

  it('builds deterministic idempotency keys for side-effecting jobs', () => {
    expect(buildTelnyxWebhookJobId('answer', 'call-123')).toBe('telnyx:answer:call-123');
    expect(buildSmsJobId('vip-alert', 'resto-1', 'call-leg-1')).toBe(
      'sms:vip-alert:resto-1:call-leg-1',
    );
    expect(buildDailyReportJobId('resto-1', '2026-06-20')).toBe('daily-report:resto-1:2026-06-20');
    expect(buildReconciliationJobId('calls', '2026-06-20')).toBe('reconciliation:calls:2026-06-20');
  });
});
