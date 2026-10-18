/**
 * Réservation test lancée depuis l'onboarding : le jeton signé par l'API
 * (`testBooking=<jeton>`) circule dans l'URL jusqu'aux appels hold/confirm.
 * Motif recopié de l'API (pas d'import entre apps) : 27 + 43 caractères base64url.
 */
export const TEST_BOOKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{27}\.[A-Za-z0-9_-]{43}$/;

export const TEST_BOOKING_BANNER =
  'Réservation test : vous voyez ce que voient vos clients. Les messages sont envoyés, mais rien n’apparaît dans votre restaurant.';

/** Renvoie le jeton s'il a la bonne forme, sinon undefined (page normale). */
export function parseTestBookingToken(value: string | undefined): string | undefined {
  return value && TEST_BOOKING_TOKEN_PATTERN.test(value) ? value : undefined;
}
