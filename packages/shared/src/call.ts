/**
 * Call intent + outcome — mirrors of Prisma enums.
 *
 * `CallIntent` = what the caller wanted (parsed by LLM at the start of the call).
 * `CallOutcome` = what actually happened (set when the call ends).
 *
 * Source of truth: `packages/database/prisma/schema.prisma`.
 */

export const CALL_INTENT_VALUES = [
  'RESERVATION',
  'HOURS',
  'MENU',
  'CANCEL',
  'OTHER',
] as const;
export type CallIntent = (typeof CALL_INTENT_VALUES)[number];

export const CALL_INTENT_LABELS: Record<CallIntent, string> = {
  RESERVATION: 'Réservation',
  HOURS: "Horaires",
  MENU: 'Carte',
  CANCEL: 'Annulation',
  OTHER: 'Autre',
};

export const CALL_OUTCOME_VALUES = [
  'RESERVED',
  'INFO',
  'NO_ACTION',
  'HANDOFF',
  'ERROR',
] as const;
export type CallOutcome = (typeof CALL_OUTCOME_VALUES)[number];

export const CALL_OUTCOME_LABELS: Record<CallOutcome, string> = {
  RESERVED: 'Réservation créée',
  INFO: 'Information donnée',
  NO_ACTION: 'Aucun action',
  HANDOFF: 'Transfert humain',
  ERROR: 'Erreur',
};

/**
 * Reasons a call can end, as emitted by the carrier (Telnyx/Vapi).
 * Telnyx in particular uses freeform strings; this is the canonical
 * subset we treat as terminal, anything else is bucketed as 'other'.
 */
export const CALL_ENDED_REASON_VALUES = [
  'transfer',
  'error',
  'customer-ended-call',
  'assistant-ended-call',
  'other',
] as const;
export type CallEndedReason = (typeof CALL_ENDED_REASON_VALUES)[number];

export function normalizeCallEndedReason(raw: string | null | undefined): CallEndedReason {
  if (!raw) return 'other';
  if ((CALL_ENDED_REASON_VALUES as readonly string[]).includes(raw)) {
    return raw as CallEndedReason;
  }
  return 'other';
}
