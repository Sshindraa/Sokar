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
  /**
   * Créneaux réels du jour du brouillon pour chaque taille de groupe, lus en
   * tâche de fond dès que la date est connue : le modèle répond en un passage.
   */
  dayAvailability: DayAvailability | null;
  reservationCreated: boolean;
  /** Début de phrase jugé inachevé par le modèle, recollé au tour suivant. */
  pendingFragment: string | null;
}

export interface DayAvailability {
  date: string;
  /** Aucun créneau généré pour ce jour : le restaurant n'ouvre pas. */
  closed: boolean;
  /** Créneaux libres par taille de groupe, de 1 au maximum vocal. */
  slotsBySize: Record<number, string[]>;
}

export function createStructuredTurnState(): StructuredTurnState {
  return {
    draft: { date: '', time: '', partySize: 0, customerName: '' },
    lastAwaiting: 'none',
    recapKey: null,
    availability: null,
    dayAvailability: null,
    reservationCreated: false,
    pendingFragment: null,
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

/**
 * Heure locale pleine et moment de la journée dans le fuseau du restaurant (« 15 h,
 * après-midi ») : un fait pour les formules de politesse. Sans les minutes, pour que la
 * requête spéculative reste identique à celle du tour final.
 */
export function dayPartInTimezone(timezone: string, now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .find((part) => part.type === 'hour')?.value,
  );
  const part = hour < 5 ? 'nuit' : hour < 12 ? 'matin' : hour < 18 ? 'après-midi' : 'soir';
  return `${hour} h, ${part}`;
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

/**
 * Brouillon lu dans le flux JSON du modèle : `draft` précède `say` dans le schéma, il est donc
 * lisible avant la première phrase. Null tant qu'il n'est pas complet ou s'il est illisible.
 */
export function parseStreamedDraft(
  streamed: string,
): { date: string; time: string; partySize: number } | null {
  const match = /"draft"\s*:\s*(\{[^{}]*\})/.exec(streamed);
  if (!match) return null;
  try {
    const draft = JSON.parse(match[1]) as Record<string, unknown>;
    return {
      date: typeof draft.date === 'string' ? draft.date : '',
      time: typeof draft.time === 'string' ? draft.time : '',
      partySize: typeof draft.partySize === 'number' ? draft.partySize : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Vrai quand les créneaux du jour, déjà lus pour ce nombre de personnes, ne contiennent pas
 * l'heure du brouillon : le modèle ne doit pas annoncer ce créneau comme libre (appel 1b3f85e9 :
 * « Pour 5, 15 h 30 est libre » alors que 15 h à 18 h était complet). Faux quand on ne sait pas
 * (brouillon incomplet, jour non lu, taille de groupe hors lecture) : le modèle reste libre.
 */
export function requestedSlotConflict(
  dayAvailability: DayAvailability | null,
  draft: { date: string; time: string; partySize: number },
): boolean {
  if (!dayAvailability || dayAvailability.date !== draft.date) return false;
  if (!/^\d{2}:\d{2}$/.test(draft.time) || draft.partySize < 1) return false;
  const slots = dayAvailability.slotsBySize[draft.partySize];
  return Array.isArray(slots) && !slots.includes(draft.time);
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
