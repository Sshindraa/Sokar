import type { CallEvent } from '@sokar/types';

export type CallOutcome = 'RESERVED' | 'INFO' | 'NO_ACTION' | 'HANDOFF' | 'ERROR';

export function detectOutcome(
  call: Pick<CallEvent, 'transcript' | 'endedReason'>
): CallOutcome {
  if (call.transcript?.match(/réservation confirmée|numéro de réservation/i)) return 'RESERVED';
  if (call.endedReason === 'transfer')  return 'HANDOFF';
  if (call.endedReason === 'error')     return 'ERROR';
  if (call.transcript?.match(/horaire|ouvert|fermé/i)) return 'INFO';
  return 'NO_ACTION';
}
