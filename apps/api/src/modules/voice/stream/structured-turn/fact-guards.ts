/**
 * Garde-fous de faits du tour structuré. Ils ne cherchent pas à comprendre
 * l'appelant : ils vérifient que les valeurs proposées par le modèle ont un
 * format valide, sont plausibles, et qu'une action à effet réel repose sur
 * des faits vérifiés (disponibilité réelle, récapitulatif accepté).
 */
import type { StructuredTurnDraft, StructuredTurnOutput } from './schema';

export type DraftField = keyof StructuredTurnDraft;

export interface StructuredTurnState {
  draft: StructuredTurnDraft;
  /** Ce que la dernière réponse parlée attendait de l'appelant. */
  lastAwaiting: StructuredTurnOutput['awaiting'];
  /** Brouillon lu au récapitulatif du tour précédent, s'il attendait un accord. */
  recapKey: string | null;
  /** Dernier résultat réel du moteur de disponibilité. */
  availability: { date: string; partySize: number; slots: string[] } | null;
  reservationCreated: boolean;
}

export function createStructuredTurnState(): StructuredTurnState {
  return {
    draft: { date: '', time: '', partySize: 0, customerName: '' },
    lastAwaiting: 'none',
    recapKey: null,
    availability: null,
    reservationCreated: false,
  };
}

const MAX_BOOKING_HORIZON_DAYS = 366;
const MAX_NAME_LENGTH = 60;

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Date du jour dans le fuseau du restaurant, au format AAAA-MM-JJ. */
export function todayInTimezone(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function isValidField(
  field: DraftField,
  value: StructuredTurnDraft[DraftField],
  context: { today: string },
): boolean {
  switch (field) {
    case 'date': {
      const date = value as string;
      return (
        isCalendarDate(date) &&
        date >= context.today &&
        date <= addDays(context.today, MAX_BOOKING_HORIZON_DAYS)
      );
    }
    case 'time':
      return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value as string);
    case 'partySize':
      return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 99;
    case 'customerName': {
      const name = (value as string).trim();
      return name.length <= MAX_NAME_LENGTH && /^[\p{L}][\p{L}\s'’-]*$/u.test(name);
    }
  }
}

function isUnset(field: DraftField, value: StructuredTurnDraft[DraftField]): boolean {
  return field === 'partySize' ? value === 0 : (value as string).trim() === '';
}

/**
 * Applique le brouillon proposé champ par champ. Une valeur invalide garde la
 * valeur précédente ; un champ vidé ne l'est que si le modèle interprète le
 * tour comme une correction.
 */
export function applyProposedDraft(
  previous: StructuredTurnDraft,
  output: Pick<StructuredTurnOutput, 'draft' | 'interpretation'>,
  context: { today: string },
): { draft: StructuredTurnDraft; rejected: DraftField[]; changed: DraftField[] } {
  const draft = { ...previous };
  const rejected: DraftField[] = [];
  const changed: DraftField[] = [];
  for (const field of Object.keys(previous) as DraftField[]) {
    const proposed = output.draft[field];
    if (proposed === previous[field]) continue;
    if (isUnset(field, proposed)) {
      if (output.interpretation === 'correction') {
        (draft as Record<DraftField, unknown>)[field] = field === 'partySize' ? 0 : '';
        changed.push(field);
      }
      continue;
    }
    const normalized = typeof proposed === 'string' ? proposed.trim() : proposed;
    if (!isValidField(field, normalized, context)) {
      rejected.push(field);
      continue;
    }
    (draft as Record<DraftField, unknown>)[field] = normalized;
    changed.push(field);
  }
  return { draft, rejected, changed };
}

export function isBookingComplete(draft: StructuredTurnDraft): boolean {
  return Boolean(draft.date && draft.time && draft.partySize > 0 && draft.customerName.trim());
}

export function bookingKey(draft: StructuredTurnDraft): string {
  return [
    draft.date,
    draft.time,
    draft.partySize,
    draft.customerName.trim().toLocaleLowerCase('fr-FR'),
  ].join(':');
}

export function isSlotVerified(state: StructuredTurnState, draft: StructuredTurnDraft): boolean {
  return Boolean(
    state.availability &&
    state.availability.date === draft.date &&
    state.availability.partySize === draft.partySize &&
    state.availability.slots.includes(draft.time),
  );
}

export type ActionDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Autorise une action à effet réel. La création exige un récapitulatif complet
 * lu au tour précédent, accepté par l'appelant selon le modèle, sur un créneau
 * vérifié. Aucune action à effet ne part sur un plan peu sûr.
 */
export function authorizeStructuredAction(
  state: StructuredTurnState,
  output: StructuredTurnOutput,
  draft: StructuredTurnDraft,
  context: { maxPartySize: number },
): ActionDecision {
  const sideEffect = output.action !== 'none' && output.action !== 'check_availability';
  if (sideEffect && output.confidence === 'low') {
    return { allowed: false, reason: 'low_confidence' };
  }
  switch (output.action) {
    case 'none':
    case 'take_message':
    case 'transfer':
    case 'end_call':
      return { allowed: true };
    case 'check_availability':
      return draft.date && draft.partySize > 0
        ? { allowed: true }
        : { allowed: false, reason: 'missing_date_or_party_size' };
    case 'create_reservation': {
      if (state.reservationCreated) return { allowed: false, reason: 'already_created' };
      if (!isBookingComplete(draft)) return { allowed: false, reason: 'incomplete_booking' };
      if (draft.partySize > context.maxPartySize) {
        return { allowed: false, reason: 'group_above_threshold' };
      }
      if (!isSlotVerified(state, draft)) return { allowed: false, reason: 'slot_not_verified' };
      if (state.lastAwaiting !== 'confirmation' || state.recapKey !== bookingKey(draft)) {
        return { allowed: false, reason: 'recap_not_read' };
      }
      if (output.interpretation !== 'affirmation') {
        return { allowed: false, reason: 'recap_not_accepted' };
      }
      return { allowed: true };
    }
  }
}
