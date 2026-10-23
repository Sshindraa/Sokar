/**
 * Réservation test lancée depuis l'onboarding : le jeton signé par l'API
 * (`testBooking=<jeton>`) circule dans l'URL jusqu'aux appels hold/confirm.
 * Le client ne vérifie pas la forme du jeton : toute valeur présente (1 à 100
 * caractères, la limite du schéma API) garde le mode test, et l'API refuse un
 * jeton invalide avec un message clair. Une page normale ne doit jamais
 * s'afficher (réservation réelle) parce qu'un lien de test est abîmé.
 */
const TEST_BOOKING_TOKEN_MAX_LENGTH = 100;

export const TEST_BOOKING_BANNER =
  'Réservation test : vous voyez ce que voient vos clients. Les messages sont envoyés, mais rien n’apparaît dans votre restaurant.';

/** Renvoie la valeur si elle est non vide et ≤ 100 caractères, sinon undefined (page normale). */
export function parseTestBookingToken(value: string | undefined): string | undefined {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= TEST_BOOKING_TOKEN_MAX_LENGTH
    ? value
    : undefined;
}
