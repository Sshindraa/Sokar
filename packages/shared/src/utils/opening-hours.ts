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
 * - Objet: { mon: { open, close }, tue: { open, close }, … }
 *   (accepte aussi opens/closes au lieu de open/close)
 * - Tableau schema.org: [{ dayOfWeek, opens, closes }, …]
 */
export function normalizeOpeningHours(raw: unknown): NormalizedOpeningHours {
  if (!raw || typeof raw !== 'object') return [];

  if (Array.isArray(raw)) {
    return raw
      .map((entry: { dayOfWeek?: string; opens?: string; closes?: string }) => {
        const dow = entry.dayOfWeek?.toLowerCase();
        if (!dow) return null;
        const dayIndex = DAY_TO_INDEX[dow];
        if (dayIndex == null || !entry.opens || !entry.closes) return null;
        return { dayIndex, open: entry.opens, close: entry.closes };
      })
      .filter((x): x is NormalizedOpeningHours[0] => x !== null)
      .sort((a, b) => a.dayIndex - b.dayIndex);
  }

  return Object.entries(raw as Record<string, unknown>)
    .map(([key, val]) => {
      const dayIndex = DAY_TO_INDEX[key.toLowerCase()];
      if (dayIndex == null) return null;
      if (!val || typeof val !== 'object') return null;
      const v = val as { open?: string; close?: string; opens?: string; closes?: string };
      const open = v.open ?? v.opens;
      const close = v.close ?? v.closes;
      if (!open || !close) return null;
      return { dayIndex, open, close };
    })
    .filter((x): x is NormalizedOpeningHours[0] => x !== null)
    .sort((a, b) => a.dayIndex - b.dayIndex);
}
