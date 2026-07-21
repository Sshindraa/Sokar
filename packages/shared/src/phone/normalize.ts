/**
 * Normalise un numéro de téléphone en format E.164 basique.
 *
 * Règles MVP (France par défaut) :
 * - conserve un '+' en tête s'il est présent
 * - remplace le double zéro international par '+'
 * - remplace un 0 préfixe de numéro français à 10 chiffres par '+33'
 * - supprime tout caractère non numérique sauf le '+'
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return '+33' + digits.slice(1);
  return digits;
}
