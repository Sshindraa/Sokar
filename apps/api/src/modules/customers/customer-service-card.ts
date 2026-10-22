import { db } from '../../shared/db/client';
import {
  computeCustomerLifecycle,
  loadCustomerVisitStats,
  type CustomerLifecycle,
} from './customer-lifecycle';

/**
 * What the team sees next to a reservation during service. Built from the
 * lifecycle, the confirmed preferences and past no-shows only: an unconfirmed
 * voice suggestion and the manager's notes never appear here.
 */
export type ServiceCardBadgeKind =
  | 'regular'
  | 'allergy'
  | 'diet'
  | 'accessibility'
  | 'occasion'
  | 'no_show_risk';

export interface ServiceCardBadge {
  kind: ServiceCardBadgeKind;
  label: string;
  detail: string;
}

export interface ReservationServiceCard {
  reservationId: string;
  customerId: string | null;
  lifecycle: CustomerLifecycle | null;
  badges: ServiceCardBadge[];
}

export const SERVICE_CARD_MAX_RESERVATIONS = 200;
/** A birthday within this many days of the reservation is shown. */
export const SERVICE_CARD_BIRTHDAY_WINDOW_DAYS = 3;
/** From this many no-shows in 12 months, the risk badge appears. */
export const SERVICE_CARD_NO_SHOW_MIN = 1;
const MAX_DETAIL_LENGTH = 120;

const OCCASION_PATTERN =
  /\b(anniversaire|fian[cç]ailles|demande en mariage|mariage|bapt[eê]me|retraite|f[eê]te|saint[- ]valentin)\b/i;
const ALLERGY_PATTERN = /allerg|intol[ée]ran|c[œo]eliaqu|sans gluten/i;

interface PreferenceForCard {
  key: string;
  value: unknown;
  source: string;
  confirmedAt: Date | null;
  expiresAt: Date | null;
}

export interface ServiceCardInput {
  reservationId: string;
  reservationDate: Date;
  specialRequests: string | null;
  customer: {
    id: string;
    birthMonth: number | null;
    birthDay: number | null;
    specialOccasion: string | null;
  } | null;
  visitDates: Date[];
  noShows365d: number;
  preferences: PreferenceForCard[];
  timezone: string;
  now: Date;
}

export function buildServiceCard(input: ServiceCardInput): ReservationServiceCard {
  const badges: ServiceCardBadge[] = [];
  if (!input.customer) {
    const occasion = occasionFromRequests(input.specialRequests);
    return {
      reservationId: input.reservationId,
      customerId: null,
      lifecycle: null,
      badges: occasion ? [occasion] : [],
    };
  }

  const lifecycle = computeCustomerLifecycle(input.visitDates, input.now);
  if (lifecycle.status === 'regular') {
    badges.push({ kind: 'regular', label: 'Habitué', detail: lifecycle.reason });
  }

  for (const preference of input.preferences) {
    if (!isConfirmed(preference, input.now)) continue;
    const value = preferenceText(preference.value);
    if (!value) continue;
    if (preference.key === 'dietary_restrictions') {
      const allergy = ALLERGY_PATTERN.test(value);
      badges.push({
        kind: allergy ? 'allergy' : 'diet',
        label: allergy ? 'Allergie' : 'Régime',
        detail: value,
      });
    } else if (preference.key === 'accessibility_needs') {
      badges.push({ kind: 'accessibility', label: 'Accessibilité', detail: value });
    }
  }

  const occasion =
    birthdayBadge(input.customer, input.reservationDate, input.timezone) ??
    occasionFromRequests(input.specialRequests) ??
    (input.customer.specialOccasion?.trim()
      ? {
          kind: 'occasion' as const,
          label: 'Occasion',
          detail: truncate(input.customer.specialOccasion.trim()),
        }
      : null);
  if (occasion) badges.push(occasion);

  if (input.noShows365d >= SERVICE_CARD_NO_SHOW_MIN) {
    const count = input.noShows365d;
    badges.push({
      kind: 'no_show_risk',
      label: count === 1 ? '1 absence' : `${count} absences`,
      detail: `${count === 1 ? 'Absent une fois' : `Absent ${count} fois`} en 12 mois`,
    });
  }

  return { reservationId: input.reservationId, customerId: input.customer.id, lifecycle, badges };
}

function isConfirmed(preference: PreferenceForCard, now: Date): boolean {
  if (preference.expiresAt && preference.expiresAt.getTime() <= now.getTime()) return false;
  return preference.source !== 'VOICE_SUGGESTION' || preference.confirmedAt !== null;
}

function preferenceText(value: unknown): string | null {
  let text: string | null = null;
  if (typeof value === 'string') text = value;
  else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    text = value.join(', ');
  }
  const trimmed = text?.replace(/\s+/g, ' ').trim();
  return trimmed ? truncate(trimmed) : null;
}

function truncate(text: string): string {
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}…` : text;
}

function occasionFromRequests(specialRequests: string | null): ServiceCardBadge | null {
  const match = specialRequests?.match(OCCASION_PATTERN);
  if (!match) return null;
  const word = match[1].toLowerCase();
  return {
    kind: 'occasion',
    label: word.charAt(0).toUpperCase() + word.slice(1),
    detail: 'Indiqué dans la demande',
  };
}

function birthdayBadge(
  customer: NonNullable<ServiceCardInput['customer']>,
  reservationDate: Date,
  timezone: string,
): ServiceCardBadge | null {
  if (!customer.birthMonth || !customer.birthDay) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(reservationDate);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  const local = Date.UTC(year, month - 1, day);
  for (const candidateYear of [year - 1, year, year + 1]) {
    const birthday = Date.UTC(candidateYear, customer.birthMonth - 1, customer.birthDay);
    const diffDays = Math.round((birthday - local) / 86_400_000);
    if (Math.abs(diffDays) <= SERVICE_CARD_BIRTHDAY_WINDOW_DAYS) {
      const when =
        diffDays === 0
          ? 'Aujourd’hui'
          : diffDays > 0
            ? `Dans ${diffDays} j`
            : `Il y a ${-diffDays} j`;
      return { kind: 'occasion', label: 'Anniversaire', detail: when };
    }
  }
  return null;
}

/**
 * Service cards for a list of reservations: four queries whatever the list
 * size, every one scoped to the restaurant. Unknown or foreign ids are ignored.
 */
export async function loadReservationServiceCards(
  restaurantId: string,
  reservationIds: string[],
  now = new Date(),
): Promise<ReservationServiceCard[]> {
  const ids = [...new Set(reservationIds)].slice(0, SERVICE_CARD_MAX_RESERVATIONS);
  if (ids.length === 0) return [];

  const [reservations, restaurant] = await Promise.all([
    db.reservation.findMany({
      where: { restaurantId, id: { in: ids } },
      select: {
        id: true,
        startsAt: true,
        reservedAt: true,
        specialRequests: true,
        customer: {
          select: {
            id: true,
            restaurantId: true,
            archivedAt: true,
            birthMonth: true,
            birthDay: true,
            specialOccasion: true,
          },
        },
      },
    }),
    db.restaurant.findUnique({ where: { id: restaurantId }, select: { timezone: true } }),
  ]);

  const customerIds = reservations
    .map((reservation) => reservation.customer)
    .filter(
      (customer): customer is NonNullable<typeof customer> =>
        customer !== null && customer.restaurantId === restaurantId && customer.archivedAt === null,
    )
    .map((customer) => customer.id);

  const [visitStats, preferences] = await Promise.all([
    loadCustomerVisitStats(restaurantId, customerIds, now),
    customerIds.length > 0
      ? db.customerPreference.findMany({
          where: {
            restaurantId,
            customerId: { in: [...new Set(customerIds)] },
            key: { in: ['dietary_restrictions', 'accessibility_needs'] },
          },
          select: {
            customerId: true,
            key: true,
            value: true,
            source: true,
            confirmedAt: true,
            expiresAt: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const preferencesByCustomer = new Map<string, PreferenceForCard[]>();
  for (const preference of preferences) {
    const list = preferencesByCustomer.get(preference.customerId) ?? [];
    list.push({ ...preference, source: String(preference.source) });
    preferencesByCustomer.set(preference.customerId, list);
  }

  const allowed = new Set(customerIds);
  return reservations.map((reservation) => {
    const customer =
      reservation.customer && allowed.has(reservation.customer.id) ? reservation.customer : null;
    const stats = customer ? visitStats.get(customer.id) : undefined;
    return buildServiceCard({
      reservationId: reservation.id,
      reservationDate: reservation.startsAt ?? reservation.reservedAt,
      specialRequests: reservation.specialRequests,
      customer,
      visitDates: stats?.visitDates ?? [],
      noShows365d: stats?.noShows365d ?? 0,
      preferences: customer ? (preferencesByCustomer.get(customer.id) ?? []) : [],
      timezone: restaurant?.timezone ?? 'Europe/Paris',
      now,
    });
  });
}
