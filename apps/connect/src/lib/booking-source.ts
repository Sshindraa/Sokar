/**
 * Sources acceptées par l'API publique Connect.
 *
 * Les pages publiques ont historiquement utilisé `widget` et `restaurant`
 * comme valeurs d'interface. Elles doivent être converties avant de traverser
 * le contrat API, qui conserve uniquement les sources de réservation métier.
 */
const BOOKING_SOURCES = [
  'google',
  'chatgpt',
  'perplexity',
  'bing',
  'restaurant_website',
  'instagram',
  'qr_code',
  'direct',
  'unknown',
  'web',
] as const;

export type BookingSource = (typeof BOOKING_SOURCES)[number];

const SOURCE_ALIASES: Record<string, BookingSource> = {
  restaurant: 'restaurant_website',
  widget: 'web',
};

/**
 * Normalise la source issue d'un query param ou d'un composant embarqué.
 * Une valeur inconnue ne doit jamais rendre une réservation impossible.
 */
export function normalizeBookingSource(source?: string): BookingSource {
  const value = source?.trim().toLowerCase();
  if (!value) return 'web';

  const alias = SOURCE_ALIASES[value];
  if (alias) return alias;

  return (BOOKING_SOURCES as readonly string[]).includes(value) ? (value as BookingSource) : 'web';
}
