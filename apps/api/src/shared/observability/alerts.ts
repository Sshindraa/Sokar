/**
 * Service d'alertes Sokar.
 *
 * Centralise les alertes critiques qui doivent déclencher Sentry
 * + idéalement PagerDuty (Phase 6+). Les alertes sont typées
 * pour qu'on puisse les grep + filtrer en prod.
 *
 * Alertes Phase 6 :
 *   - double_booking : une tentative de double booking (jamais ne devrait arriver)
 *   - pii_leak : PII détectée dans une tool response
 *   - error_rate_high : 5xx > 1% sur une fenêtre de 5 min (à implémenter en cron)
 */

import { captureException, captureMessage } from '../sentry/client';
import { doubleBookingAttemptsTotal, piiLeaksTotal } from './metrics';
import { logger } from '../logger/pino';

export type AlertKind = 'double_booking' | 'pii_leak' | 'error_rate_high' | 'agent_unavailable';

export function alertDoubleBooking(args: {
  restaurantId: string;
  partySize: number;
  slotStart: string;
  attemptedBy: string;
}): void {
  doubleBookingAttemptsTotal.inc();
  logger.error(
    {
      alert: 'double_booking',
      ...args,
    },
    'DOUBLE BOOKING ATTEMPT — should never happen with partial unique index',
  );
  captureException(new Error('Double booking attempt'), {
    tags: { alert: 'double_booking' },
    extra: args,
  });
}

export function alertPiiLeak(args: {
  tool: string;
  kind: 'phone' | 'email' | 'hex';
  path: string;
  sample: string;
}): void {
  piiLeaksTotal.inc({ kind: args.kind });
  logger.error(
    {
      alert: 'pii_leak',
      ...args,
    },
    'PII LEAK in tool response — redaction failed',
  );
  captureException(new Error('PII leak in tool response'), {
    tags: { alert: 'pii_leak', kind: args.kind, tool: args.tool },
    extra: args,
  });
}

export function alertErrorRateHigh(args: { rate5xx: number; windowMin: number }): void {
  if (args.rate5xx < 0.01) return; // < 1%, on n'alerte pas
  logger.error(
    {
      alert: 'error_rate_high',
      ...args,
    },
    `5xx rate ${(args.rate5xx * 100).toFixed(2)}% exceeds 1% threshold`,
  );
  captureMessage(`5xx rate high: ${(args.rate5xx * 100).toFixed(2)}%`, 'error', {
    tags: { alert: 'error_rate_high' },
    extra: args,
  });
}

export function alertAgentUnavailable(args: { agent: string; reason: string }): void {
  logger.error({ alert: 'agent_unavailable', ...args }, 'Agent IA indisponible');
  captureException(new Error('Agent unavailable'), {
    tags: { alert: 'agent_unavailable', agent: args.agent },
    extra: args,
  });
}
