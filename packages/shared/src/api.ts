/**
 * Standard API error response shape.
 *
 * Every error response from the API follows this shape so the dashboard
 * can render consistent toasts/error states without per-route branching.
 *
 * Convention:
 * - 4xx → user-actionable (validation, auth, conflict)
 * - 5xx → server fault, always log to Sentry
 *
 * Adding a new error code: add the literal to ERROR_CODE_VALUES, give it
 * a French default message, and update the dashboard's toast mapper.
 */

export const ERROR_CODE_VALUES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'SLOT_NOT_AVAILABLE',
  'CARRIER_ERROR',
  'PAYMENT_REQUIRED',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];

export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  /** Field-level details (e.g. Zod issues) — present only on VALIDATION_ERROR. */
  details?: unknown;
  /** Trace ID for support — always present on 5xx, optional on 4xx. */
  traceId?: string;
}

export const ERROR_CODE_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Les données envoyées sont invalides.',
  UNAUTHENTICATED: 'Veuillez vous reconnecter.',
  FORBIDDEN: 'Accès refusé.',
  NOT_FOUND: 'Ressource introuvable.',
  CONFLICT: 'Conflit avec l’état actuel.',
  RATE_LIMITED: 'Trop de requêtes. Réessayez dans quelques instants.',
  SLOT_NOT_AVAILABLE: 'Ce créneau n’est plus disponible.',
  CARRIER_ERROR: 'Le transporteur téléphonique a renvoyé une erreur.',
  PAYMENT_REQUIRED: 'Abonnement requis pour cette action.',
  INTERNAL_ERROR: 'Une erreur est survenue. Réessayez ou contactez le support.',
};
