import { redisCache } from '../redis/client';
import { logger } from '../logger/pino';
import { dispatchAlert, dispatchAlertEmail } from './alert-dispatcher';
import type { SystemFinding } from './system-checks';
import { withTimeout } from '../resilience';

const REMINDER_SECONDS = 2 * 3600;
const CLAIM_SECONDS = 60;

export async function dispatchSystemFindings(
  findings: SystemFinding[],
): Promise<{ dispatched: number; suppressed: number }> {
  for (const finding of findings) {
    const key = `sokar:system-alert:v1:${finding.kind}:${finding.identifier}:${finding.severity}:channels`;
    let notify = true;
    try {
      notify =
        (await withTimeout(
          redisCache.set(key, 'sent', 'EX', 1800, 'NX'),
          500,
          'system-alert.channels',
        )) === 'OK';
    } catch {
      // Keep the existing incident channels available when storage fails.
    }
    if (notify) await dispatchAlert({ ...finding, email: false });
  }
  const claimed: { finding: SystemFinding; key: string; owned: boolean }[] = [];
  for (const finding of findings) {
    // A distinct queue or an escalation must not inherit another incident's cooldown.
    const key = `sokar:system-alert:v1:${finding.kind}:${finding.identifier}:${finding.severity}`;
    try {
      if (
        !(await withTimeout(
          redisCache.set(key, 'pending', 'EX', CLAIM_SECONDS, 'NX'),
          500,
          'system-alert.claim',
        ))
      )
        continue;
      claimed.push({ finding, key, owned: true });
    } catch {
      logger.warn(
        { kind: finding.kind },
        'Alert cooldown unavailable; preserving incident dispatch',
      );
      claimed.push({ finding, key, owned: false });
    }
  }
  if (claimed.length === 0) return { dispatched: 0, suppressed: findings.length };
  const result = await dispatchAlertEmail({
    kind: 'system_health_digest',
    severity: claimed.some(({ finding }) => finding.severity === 'critical')
      ? 'critical'
      : 'warning',
    summary: `${claimed.length} alerte(s) système : ${claimed.map(({ finding }) => finding.identifier).join(', ')}`,
    detail: claimed
      .map(({ finding }) => `[${finding.severity}] ${finding.summary}\n${finding.detail}`)
      .join('\n\n'),
  });
  // A refused email is not marked delivered. The short lease prevents concurrent bursts.
  if (!result || result.ok) {
    for (const { key, owned } of claimed) {
      if (!owned) continue;
      try {
        await withTimeout(
          redisCache.set(key, 'sent', 'EX', REMINDER_SECONDS),
          500,
          'system-alert.reminder',
        );
      } catch {
        logger.warn('Failed to persist system alert reminder cooldown');
      }
    }
  }
  return { dispatched: claimed.length, suppressed: findings.length - claimed.length };
}
