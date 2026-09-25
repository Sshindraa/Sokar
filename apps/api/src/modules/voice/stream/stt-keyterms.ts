const RESERVATION_KEYTERMS = [
  // Français
  'réservation',
  'réserver',
  'personnes',
  'soir',
  'heures',
  'midi',
  'couverts',
  'deux',
  'double',
  'épeler',
  'au nom de',
  'demain',
  'aujourd’hui',
  'trois',
  'quatre',
  'cinq',
  'six',
  'sept',
  'huit',
  'neuf',
  'dix',
  // Anglais
  'reservation',
  'reserve',
  'table',
  'people',
  'tonight',
  'tomorrow',
  'booking',
  'dinner',
  'lunch',
  // Espagnol
  'reserva',
  'reservar',
  'mesa',
  'personas',
  // Italien
  'prenotazione',
  'prenotare',
  'tavolo',
  'persone',
  'domani',
  // Allemand
  'reservierung',
  'reservieren',
  'tisch',
  'morgen',
  // Portugais
  'pessoas',
  'amanhã',
  // Néerlandais
  'reservering',
  'reserveren',
  'tafel',
];

const MAX_STT_KEYTERMS = 50;
const MAX_STT_KEYTERM_LENGTH = 20;

/** Restaurant terms come first so generic multilingual terms cannot use all slots. */
export function buildSttKeyterms(
  restaurantName?: string,
  additionalKeyterms: readonly string[] = [],
): string[] {
  const candidates = [restaurantName ?? '', ...additionalKeyterms, ...RESERVATION_KEYTERMS];
  const keyterms: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const normalized = candidate.trim().replace(/\s+/gu, ' ');
    if (!normalized) continue;

    const values =
      normalized.length <= MAX_STT_KEYTERM_LENGTH
        ? [normalized]
        : normalized.split(' ').filter((word) => word.length <= MAX_STT_KEYTERM_LENGTH);

    for (const value of values) {
      const dedupeKey = value.toLocaleLowerCase('fr-FR');
      if (!value || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      keyterms.push(value);
      if (keyterms.length >= MAX_STT_KEYTERMS) return keyterms;
    }
  }

  return keyterms;
}
