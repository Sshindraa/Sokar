import type { CallEvent } from '@sokar/types';

export type CallOutcome = 'RESERVED' | 'INFO' | 'NO_ACTION' | 'HANDOFF' | 'ERROR';

// Words/phrases that signal the caller is asking to book (or just booked
// and the call dropped). Kept French-only — this product is fr-first.
// We intentionally stay conservative: a false positive here triggers an
// outbound SMS, so we'd rather miss some recoverable calls than spam.
const RESERVATION_INTENT_RE =
  /(?:réserv|table|booker|booking|disponib|ce soir|demain|personnes? pour|à \d{1,2}h?[:h]\d{0,2})/i;

const HANGUP_REASONS_NO_INTENT = new Set([
  'busy',
  'no-answer',
  'cancel',
  'hangup', // pure silence, no conversation
]);

export function detectOutcome(call: Pick<CallEvent, 'transcript' | 'endedReason'>): CallOutcome {
  if (call.transcript?.match(/réservation confirmée|numéro de réservation/i)) return 'RESERVED';
  if (call.endedReason === 'transfer') return 'HANDOFF';
  if (call.endedReason === 'error') return 'ERROR';
  if (call.transcript?.match(/horaire|ouvert|fermé/i)) return 'INFO';
  return 'NO_ACTION';
}

/**
 * Did the caller clearly want to book (or appear to be in the middle of
 * booking) but the call never produced a confirmed reservation? Used to gate
 * the recovery SMS — we don't want to SMS someone who just asked about hours.
 */
export function hadReservationIntent(call: Pick<CallEvent, 'transcript' | 'endedReason'>): boolean {
  if (!call.transcript) return false;
  if (call.endedReason && HANGUP_REASONS_NO_INTENT.has(call.endedReason)) return false;
  return RESERVATION_INTENT_RE.test(call.transcript);
}
