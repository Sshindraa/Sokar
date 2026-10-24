/**
 * Réservation test lancée depuis l'onboarding : le jeton signé par l'API
 * (`testBooking=<jeton>`) circule dans l'URL jusqu'aux appels hold/confirm.
 * Toute valeur présente garde le mode test ; une valeur vide ou hors limite
 * devient un marqueur invalide que l'API refuse avec un message clair.
 * Une page normale ne doit jamais
 * s'afficher (réservation réelle) parce qu'un lien de test est abîmé.
 */
const TEST_BOOKING_TOKEN_MAX_LENGTH = 100;

export const TEST_BOOKING_BANNER =
  'Réservation test : vous voyez ce que voient vos clients. Les notifications dépendent des options du restaurant ; cette réservation n’apparaîtra pas dans votre planning.';

/** Une valeur présente reste en mode test ; les valeurs hors contrat sont refusées par l'API. */
export function parseTestBookingToken(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > 0 && value.length <= TEST_BOOKING_TOKEN_MAX_LENGTH ? value : 'invalid';
}
