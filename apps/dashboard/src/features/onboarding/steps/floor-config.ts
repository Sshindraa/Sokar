export type TableCounts = Record<number, number>;

export type FloorResponse = {
  tables: Array<{ capacity: number; count: number }>;
  stats: { tableCount: number; seatCount: number; largestTableCapacity: number };
};

export const COMMON_SIZES = [2, 4, 6, 8];
export const OTHER_SIZES = [1, 3, 5, 7, 9, 10, 12, 15, 20];
export const MAX_PER_SIZE = 60;

export const TEMPLATES: Array<{ label: string; counts: TableCounts }> = [
  { label: 'Petite salle', counts: { 2: 4, 4: 3 } },
  { label: 'Salle moyenne', counts: { 2: 6, 4: 6, 6: 2 } },
  { label: 'Grande salle', counts: { 2: 8, 4: 10, 6: 4, 8: 2 } },
];

export const DURATIONS = [60, 75, 90, 105, 120, 150, 180];
export const DEFAULT_DURATION = 90;
export const MIN_DURATION = 30;
export const MAX_DURATION = 300;
export const DEFAULT_MAX_PARTY = 7;

export const CANCELLATION_PRESETS = [
  {
    id: '2h',
    label: 'Gratuite jusqu’à 2 h avant',
    short: '2 h',
    text: "Annulation gratuite jusqu'à 2 heures avant le service.",
  },
  {
    id: '24h',
    label: 'Gratuite jusqu’à 24 h avant',
    short: '24 h',
    text: "Annulation gratuite jusqu'à 24 heures avant le service.",
  },
  {
    id: '48h',
    label: 'Gratuite jusqu’à 48 h avant',
    short: '48 h',
    text: "Annulation gratuite jusqu'à 48 heures avant le service.",
  },
  {
    id: 'none',
    label: 'Pas d’annulation gratuite',
    short: 'Pas d’annulation',
    text: "Pas d'annulation gratuite.",
  },
] as const;
export const CUSTOM_CANCELLATION = 'custom';

/** Libellé et valeur du récapitulatif client pour une condition d'annulation. */
export function cancellationSummary(presetId: string): { label: string; value: string } {
  const preset = CANCELLATION_PRESETS.find((item) => item.id === presetId);
  if (!preset) return { label: 'Annulation', value: 'Sur mesure' };
  return preset.id === 'none'
    ? { label: 'Annulation gratuite', value: 'Aucune' }
    : { label: 'Annulation gratuite jusqu’à', value: `${preset.short} avant` };
}

export function tableLabel(capacity: number) {
  return capacity === 1 ? 'Table de 1 personne' : `Table de ${capacity} personnes`;
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`;
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

export function firstPositive(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === 'number' && value > 0);
}

/** Les règles sont enregistrées quand la durée d'un repas l'est : c'est la clé lue par la disponibilité. */
export function hasStoredRules(specials: Record<string, unknown>): boolean {
  return (
    firstPositive(specials.serviceDurationMinutes, specials.defaultServiceDurationMinutes) !==
    undefined
  );
}

/** Forme canonique des tables à enregistrer : sert à savoir si la salle a changé depuis la dernière sauvegarde. */
export function tablesPayload(counts: TableCounts): Array<{ capacity: number; count: number }> {
  return Object.entries(counts)
    .map(([size, count]) => ({ capacity: Number(size), count }))
    .filter((row) => row.count > 0)
    .sort((a, b) => a.capacity - b.capacity);
}
