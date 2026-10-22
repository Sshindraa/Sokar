import { db } from '../../shared/db/client';
import { CUSTOMER_PREFERENCE_KEYS, type CustomerPreferenceKey } from './customer-crm.service';

/**
 * What the voice agent may know about a recognised caller, read from the
 * reservations and the confirmed CRM data at call start. Dates are ISO strings
 * so the profile survives a JSON cache without turning into broken Date objects.
 */
export interface CustomerVoiceProfile {
  /** Past reservations the caller did not cancel and was not marked absent for. */
  pastVisits: number;
  lastVisitAt: string | null;
  upcomingReservation: { startsAt: string; partySize: number } | null;
  /** Median party size of the past visits; null without any visit. */
  typicalPartySize: number | null;
  preferences: Array<{ key: CustomerPreferenceKey; value: string }>;
  tags: string[];
  /**
   * Name given on the latest reservation, for customers whose record has none: phone bookings
   * did not write the name to the customer record before 22/10/2026 (cached lookup).
   */
  lastReservationName: string | null;
}

interface ReservationForHistory {
  state: string;
  startsAt: Date | null;
  reservedAt: Date;
  partySize: number;
}

interface PreferenceForVoice {
  key: string;
  value: unknown;
  source: string;
  confirmedAt: Date | null;
  expiresAt: Date | null;
}

/**
 * HONORED and SEATED are proven visits. Most restaurants never close a
 * reservation in the floor plan, so a past CONFIRMED reservation that nobody
 * cancelled or marked absent is counted as a visit too: it is the best evidence
 * available, and far closer to reality than counting every phone booking.
 */
const PAST_VISIT_STATES = new Set(['HONORED', 'SEATED', 'CONFIRMED']);
const UPCOMING_STATES = new Set(['PENDING', 'CONFIRMED']);

/** Whether a reservation in this state, once past, counts as a real visit. */
export function isPastVisitState(state: string): boolean {
  return PAST_VISIT_STATES.has(state);
}
const HISTORY_LIMIT = 500;
const MAX_TAGS = 8;
const MAX_VALUE_LENGTH = 120;

export function summarizeVisitHistory(
  reservations: ReservationForHistory[],
  now: Date,
): Pick<
  CustomerVoiceProfile,
  'pastVisits' | 'lastVisitAt' | 'upcomingReservation' | 'typicalPartySize'
> {
  const pastPartySizes: number[] = [];
  let lastVisit: Date | null = null;
  let upcoming: ReservationForHistory | null = null;
  let upcomingDate: Date | null = null;

  for (const reservation of reservations) {
    const date = reservation.startsAt ?? reservation.reservedAt;
    if (date.getTime() < now.getTime()) {
      if (!PAST_VISIT_STATES.has(reservation.state)) continue;
      pastPartySizes.push(reservation.partySize);
      if (!lastVisit || date > lastVisit) lastVisit = date;
    } else if (UPCOMING_STATES.has(reservation.state) && (!upcomingDate || date < upcomingDate)) {
      upcoming = reservation;
      upcomingDate = date;
    }
  }

  return {
    pastVisits: pastPartySizes.length,
    lastVisitAt: lastVisit?.toISOString() ?? null,
    upcomingReservation:
      upcoming && upcomingDate
        ? { startsAt: upcomingDate.toISOString(), partySize: upcoming.partySize }
        : null,
    typicalPartySize: median(pastPartySizes),
  };
}

function median(values: number[]): number | null {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * Only what the team entered or confirmed reaches the agent: an unconfirmed
 * voice suggestion never becomes a fact the agent repeats to the caller.
 */
export function selectVoicePreferences(
  preferences: PreferenceForVoice[],
  now: Date,
): CustomerVoiceProfile['preferences'] {
  const selected: CustomerVoiceProfile['preferences'] = [];
  for (const preference of preferences) {
    if (!(CUSTOMER_PREFERENCE_KEYS as readonly string[]).includes(preference.key)) continue;
    if (preference.expiresAt && preference.expiresAt.getTime() <= now.getTime()) continue;
    if (preference.source === 'VOICE_SUGGESTION' && !preference.confirmedAt) continue;
    const value = preferenceText(preference.value);
    if (!value) continue;
    selected.push({ key: preference.key as CustomerPreferenceKey, value });
  }
  return selected;
}

function preferenceText(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === 'string') text = value;
  else if (typeof value === 'number' && Number.isFinite(value)) text = String(value);
  else if (typeof value === 'boolean') text = value ? 'oui' : 'non';
  else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    text = value.join(', ');
  }
  const trimmed = text?.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_VALUE_LENGTH ? `${trimmed.slice(0, MAX_VALUE_LENGTH)}…` : trimmed;
}

export async function loadCustomerVoiceProfile(
  restaurantId: string,
  customerId: string,
  now = new Date(),
): Promise<CustomerVoiceProfile> {
  const [reservations, preferences, tagAssignments] = await Promise.all([
    db.reservation.findMany({
      where: { restaurantId, customerId },
      select: {
        state: true,
        startsAt: true,
        reservedAt: true,
        partySize: true,
        customerName: true,
      },
      orderBy: { reservedAt: 'desc' },
      take: HISTORY_LIMIT,
    }),
    db.customerPreference.findMany({
      where: { restaurantId, customerId },
      select: { key: true, value: true, source: true, confirmedAt: true, expiresAt: true },
      orderBy: { key: 'asc' },
    }),
    db.customerTagAssignment.findMany({
      where: { customerId, tag: { restaurantId } },
      select: { tag: { select: { label: true } } },
      orderBy: { assignedAt: 'desc' },
      take: MAX_TAGS,
    }),
  ]);

  return {
    ...summarizeVisitHistory(
      reservations.map((reservation) => ({ ...reservation, state: String(reservation.state) })),
      now,
    ),
    preferences: selectVoicePreferences(
      preferences.map((preference) => ({ ...preference, source: String(preference.source) })),
      now,
    ),
    tags: tagAssignments.map((assignment) => assignment.tag.label.trim()).filter(Boolean),
    lastReservationName: latestReservationName(reservations),
  };
}

/** Walk-in placeholders written by the floor plan are not a caller's name. */
const PLACEHOLDER_NAMES = new Set(['sans réservation', 'walk-in', 'walk in']);
const MAX_NAME_LENGTH = 80;

/** Most recent non-placeholder name; reservations come newest first. */
export function latestReservationName(
  reservations: ReadonlyArray<{ customerName?: string | null }>,
): string | null {
  for (const reservation of reservations) {
    const name = reservation.customerName?.replace(/\s+/g, ' ').trim();
    if (!name || PLACEHOLDER_NAMES.has(name.toLowerCase())) continue;
    return name.length > MAX_NAME_LENGTH ? name.slice(0, MAX_NAME_LENGTH) : name;
  }
  return null;
}
