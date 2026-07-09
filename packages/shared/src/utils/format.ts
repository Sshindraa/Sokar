/**
 * Formate un montant en euros (format français, 2 décimales).
 */
export function formatEuro(amount: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

/**
 * Formate une date en format localisable.
 *
 * @param date - Date ISO (string) ou objet Date. Null/undefined renvoie '—'.
 * @param locale - Locale BCP-47 (défaut: 'fr-FR').
 * @param options - Options Intl.DateTimeFormatOptions (défaut: jour/mois long/année).
 */
export function formatDate(
  date: string | Date | null | undefined,
  locale: string = 'fr-FR',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' },
): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, options).format(d);
}
