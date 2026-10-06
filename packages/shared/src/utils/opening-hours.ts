/**
 * Heures d'ouverture normalisées: { dayIndex, open, close } trié par jour.
 * dayIndex: 0 = dimanche, 1 = lundi, … 6 = samedi (cf. Date#getUTCDay).
 */
export type NormalizedOpeningHours = { dayIndex: number; open: string; close: string }[];

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
  ): NormalizedOpeningHours => {
    const openTime = parseTime(open);
    const closeTime = parseTime(close);
    if (openTime == null || closeTime == null) return [];
    if (closeTime > openTime) return [{ dayIndex, open, close }];

    // A close before 06:00 belongs to the following calendar day.
    if (closeTime < openTime && closeTime <= 6 * 60) {
      return [
        { dayIndex, open, close: '24:00' },
        ...(closeTime > 0 ? [{ dayIndex: (dayIndex + 1) % 7, open: '00:00', close }] : []),
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
        slots?: unknown;
        services?: unknown;
      };
      const periods = Array.isArray(v.slots) && v.slots.length > 0 ? v.slots : v.services;
      if (Array.isArray(periods)) {
        const normalized = periods.flatMap((service: { open?: string; close?: string } | null) => {
          if (!service?.open || !service.close) return [];
          return normalizePeriod(dayIndex, service.open, service.close);
        });
        if (normalized.length > 0) return normalized;
      }
      const open = v.open ?? v.opens;
      const close = v.close ?? v.closes;
      if (!open || !close) return [];
      return normalizePeriod(dayIndex, open, close);
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
