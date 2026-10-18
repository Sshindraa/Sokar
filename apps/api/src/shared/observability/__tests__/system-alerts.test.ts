import { beforeEach, describe, expect, it, vi } from 'vitest';
import { redisCache } from '../../redis/client';
import { dispatchAlert, dispatchAlertEmail } from '../alert-dispatcher';
import { dispatchSystemFindings } from '../system-alerts';
import type { SystemFinding } from '../system-checks';

vi.mock('../alert-dispatcher', () => ({ dispatchAlert: vi.fn(), dispatchAlertEmail: vi.fn() }));

const finding: SystemFinding = {
  kind: 'failed_jobs',
  identifier: 'outbox',
  severity: 'warning',
  summary: 'Jobs en erreur',
  detail: 'Diagnostic',
};

describe('system alert grouping', () => {
  beforeEach(() => {
    vi.mocked(redisCache.set).mockReset().mockResolvedValue('OK');
    vi.mocked(dispatchAlert).mockReset().mockResolvedValue([]);
    vi.mocked(dispatchAlertEmail).mockReset().mockResolvedValue({ channel: 'email', ok: true });
  });

  it('groups distinct incidents into one email and preserves individual channels', async () => {
    const result = await dispatchSystemFindings([
      finding,
      { ...finding, identifier: 'analytics', severity: 'critical' },
    ]);
    expect(result).toEqual({ dispatched: 2, suppressed: 0 });
    expect(dispatchAlert).toHaveBeenCalledTimes(2);
    expect(dispatchAlert).toHaveBeenCalledWith(expect.objectContaining({ email: false }));
    expect(dispatchAlertEmail).toHaveBeenCalledTimes(1);
    expect(dispatchAlertEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'critical',
        detail: expect.stringContaining('Diagnostic'),
      }),
    );
    expect(redisCache.set).toHaveBeenCalledWith(expect.any(String), 'sent', 'EX', 7200);
  });

  it('does not resend a persistent incident before its reminder', async () => {
    vi.mocked(redisCache.set).mockResolvedValue(null);
    expect(await dispatchSystemFindings([finding])).toEqual({ dispatched: 0, suppressed: 1 });
    expect(dispatchAlertEmail).not.toHaveBeenCalled();
  });

  it('uses separate claims for severity escalation and distinct queues', async () => {
    await dispatchSystemFindings([finding, { ...finding, severity: 'critical' }]);
    const claims = vi.mocked(redisCache.set).mock.calls.filter((call) => call[1] === 'pending');
    expect(claims[0][0]).not.toEqual(claims[1][0]);
    expect(claims[0].slice(2)).toEqual(['EX', 60, 'NX']);
  });

  it('does not mark an email refusal as delivered', async () => {
    vi.mocked(dispatchAlertEmail).mockResolvedValue({ channel: 'email', ok: false });
    await dispatchSystemFindings([finding]);
    expect(redisCache.set).not.toHaveBeenCalledWith(expect.any(String), 'sent', 'EX', 7200);
  });

  it('preserves incident dispatch when cooldown storage fails', async () => {
    vi.mocked(redisCache.set).mockRejectedValue(new Error('offline'));
    await dispatchSystemFindings([finding]);
    expect(dispatchAlert).toHaveBeenCalledTimes(1);
    expect(dispatchAlertEmail).toHaveBeenCalledTimes(1);
  });

  it('sends nothing for an empty tick', async () => {
    expect(await dispatchSystemFindings([])).toEqual({ dispatched: 0, suppressed: 0 });
    expect(dispatchAlertEmail).not.toHaveBeenCalled();
  });

  it('keeps channel reminders at 30 minutes while grouping email reminders at two hours', async () => {
    let now = 0;
    const stored = new Map<string, number>();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.mocked(redisCache.set).mockImplementation(async (...args) => {
      const key = String(args[0]);
      if (args.includes('NX') && (stored.get(key) ?? -1) > now) return null;
      stored.set(key, now + Number(args[3]) * 1000);
      return 'OK';
    });
    try {
      await dispatchSystemFindings([finding]);
      now = 30 * 60 * 1000;
      await dispatchSystemFindings([finding]);
      expect(dispatchAlert).toHaveBeenCalledTimes(2);
      expect(dispatchAlertEmail).toHaveBeenCalledTimes(1);
      now = 2 * 3600 * 1000;
      await dispatchSystemFindings([finding]);
      expect(dispatchAlertEmail).toHaveBeenCalledTimes(2);
    } finally {
      clock.mockRestore();
    }
  });
});
