/**
 * Helpers for the reservation time contract.
 *
 * Public reservation inputs are local date/time values in the restaurant's
 * timezone. Persisted instants remain JavaScript Dates (UTC at the storage
 * boundary). Keeping the conversion here avoids each reservation caller
 * implementing a subtly different DST rule.
 */

export const DEFAULT_RESTAURANT_TIMEZONE = 'Europe/Paris';

/**
 * Convert a local restaurant date/time (for example 2026-07-02 + 19:00) to
 * the corresponding UTC instant without relying on the API process timezone.
 */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  // Date "naive" : comme si l'heure locale était UTC.
  const naive = new Date(
    `${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
  );

  // Formater cette date dans la timezone cible pour déterminer l'offset DST
  // applicable à cette date.
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(naive);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  const localYear = parseInt(get('year'), 10);
  const localMonth = parseInt(get('month'), 10) - 1;
  const localDay = parseInt(get('day'), 10);
  const localHour = parseInt(get('hour'), 10) % 24;
  const localMinute = parseInt(get('minute'), 10);

  // L'offset est la différence entre l'heure affichée dans la timezone et
  // l'heure naive. On le retire pour obtenir l'instant UTC correspondant.
  const localAsUtc = Date.UTC(localYear, localMonth, localDay, localHour, localMinute, 0);
  const offsetMs = localAsUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}
