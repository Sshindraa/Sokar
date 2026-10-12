/** Fuseau par défaut d'un restaurant (celui de l'API, `DEFAULT_RESTAURANT_TIMEZONE`). */
export const DEFAULT_RESTAURANT_TIMEZONE = 'Europe/Paris';

/**
 * Le jour calendaire (`YYYY-MM-DD`) qu'il est CHEZ le restaurant. `new Date().toISOString()` donne le
 * jour UTC : entre minuit et 2 h à Paris (été) ou 1 h (hiver), il retarde d'un jour, et la page
 * annoncerait les créneaux de la veille. Un fuseau inconnu retombe sur le fuseau par défaut.
 */
export function todayInTimezone(
  timeZone: string = DEFAULT_RESTAURANT_TIMEZONE,
  now: Date = new Date(),
): string {
  const format = (zone: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  try {
    return format(timeZone);
  } catch {
    return format(DEFAULT_RESTAURANT_TIMEZONE);
  }
}
