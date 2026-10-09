/**
 * Heures d'ouverture normalisées: { dayIndex, open, close, lastBooking? } trié par jour.
 * dayIndex: 0 = dimanche, 1 = lundi, … 6 = samedi (cf. Date#getUTCDay).
 * lastBooking: dernière heure de début de réservation du service (incluse). Absent = règle par
 * défaut (dernier créneau qui tient avant la fermeture); null = période non réservable (suite,
 * après minuit, d'un service dont la dernière réservation tombe avant minuit).
 */
export type NormalizedOpeningHours = {
  dayIndex: number;
  open: string;
  close: string;
  lastBooking?: string | null;
}[];

export const BOOKING_STEP_MINUTES = 30;

const DAY_TO_INDEX: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Normalise un JSON openingHours brut en tableau plat trié par dayIndex.
 *
 * Formats supportés:
 * - Objet: { mon: { open, close, slots?: [...] | services?: [...] }, … }
 *   (accepte aussi opens/closes au lieu de open/close)
 * - Tableau schema.org: [{ dayOfWeek, opens, closes }, …]
 */
export function normalizeOpeningHours(raw: unknown): NormalizedOpeningHours {
  if (!raw || typeof raw !== 'object') return [];

  const normalizePeriod = (
    dayIndex: number,
    open: string,
    close: string,
    rawLastBooking?: unknown,
  ): NormalizedOpeningHours => {
    const openTime = parseTime(open);
    const closeTime = parseTime(close);
    if (openTime == null || closeTime == null) return [];
    const lastBooking =
      typeof rawLastBooking === 'string' && parseTime(rawLastBooking) != null
        ? rawLastBooking
        : undefined;
    if (closeTime > openTime) {
      return [{ dayIndex, open, close, ...(lastBooking ? { lastBooking } : {}) }];
    }

    // A close before 06:00 belongs to the following calendar day.
    if (closeTime < openTime && closeTime <= 6 * 60) {
      // A lastBooking earlier than the opening hour falls after midnight.
      const afterMidnight = lastBooking != null && parseTime(lastBooking)! < openTime;
      return [
        {
          dayIndex,
          open,
          close: '24:00',
          ...(lastBooking && !afterMidnight ? { lastBooking } : {}),
        },
        ...(closeTime > 0
          ? [
              {
                dayIndex: (dayIndex + 1) % 7,
                open: '00:00',
                close,
                ...(lastBooking ? { lastBooking: afterMidnight ? lastBooking : null } : {}),
              },
            ]
          : []),
      ];
    }
    return [];
  };

  if (Array.isArray(raw)) {
    return raw
      .flatMap((entry: { dayOfWeek?: string; opens?: string; closes?: string }) => {
        const dow = entry.dayOfWeek?.toLowerCase();
        if (!dow) return [];
        const dayIndex = DAY_TO_INDEX[dow];
        if (dayIndex == null || !entry.opens || !entry.closes) return [];
        return normalizePeriod(dayIndex, entry.opens, entry.closes);
      })
      .sort((a, b) => a.dayIndex - b.dayIndex);
  }

  return Object.entries(raw as Record<string, unknown>)
    .flatMap(([key, val]) => {
      const dayIndex = DAY_TO_INDEX[key.toLowerCase()];
      if (dayIndex == null || !val || typeof val !== 'object') return [];
      const v = val as {
        open?: string;
        close?: string;
        opens?: string;
        closes?: string;
        lastBooking?: unknown;
        slots?: unknown;
        services?: unknown;
      };
      const periods = Array.isArray(v.slots) && v.slots.length > 0 ? v.slots : v.services;
      if (Array.isArray(periods)) {
        const normalized = periods.flatMap(
          (service: { open?: string; close?: string; lastBooking?: unknown } | null) => {
            if (!service?.open || !service.close) return [];
            return normalizePeriod(dayIndex, service.open, service.close, service.lastBooking);
          },
        );
        if (normalized.length > 0) return normalized;
      }
      const open = v.open ?? v.opens;
      const close = v.close ?? v.closes;
      if (!open || !close) return [];
      return normalizePeriod(dayIndex, open, close, v.lastBooking);
    })
    .sort((a, b) => a.dayIndex - b.dayIndex || a.open.localeCompare(b.open));
}

function parseTime(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

type BookingPeriod = { open: string; close: string; lastBooking?: string | null };

function formatTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`;
}

/**
 * Créneaux de réservation d'un service, par pas de 30 min depuis l'ouverture.
 * Sans lastBooking: tant que le créneau tient avant la fermeture (règle historique).
 * Avec lastBooking: jusqu'à cette heure incluse, sans jamais atteindre la fermeture.
 */
export function bookingSlotsOf(
  period: BookingPeriod,
  stepMinutes: number = BOOKING_STEP_MINUTES,
): string[] {
  if (period.lastBooking === null) return [];
  const open = parseTime(period.open);
  const close = period.close === '24:00' ? 24 * 60 : parseTime(period.close);
  if (open == null || close == null) return [];
  const last = period.lastBooking == null ? null : parseTime(period.lastBooking);

  const slots: string[] = [];
  for (let current = open; ; current += stepMinutes) {
    const fits = last == null ? current + stepMinutes <= close : current <= last && current < close;
    if (!fits) break;
    slots.push(formatTime(current));
  }
  return slots;
}

/** Dernière heure de réservation effective d'un service (null si aucun créneau). */
export function lastBookingOf(
  period: BookingPeriod,
  stepMinutes: number = BOOKING_STEP_MINUTES,
): string | null {
  return bookingSlotsOf(period, stepMinutes).at(-1) ?? null;
}
