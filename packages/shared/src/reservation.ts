/**
 * Reservation status — mirror of Prisma `ReservationStatus` enum.
 *
 * Lifecycle: CONFIRMED → (CANCELLED | NO_SHOW | SEATED)
 * A reservation is created CONFIRMED by the voice pipeline or the dashboard.
 *
 * Source of truth: `packages/database/prisma/schema.prisma`.
 */

export const RESERVATION_STATUS_VALUES = [
  'CONFIRMED',
  'CANCELLED',
  'NO_SHOW',
  'SEATED',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUS_VALUES)[number];

/**
 * Statuses that count as "active" for availability/slot-conflict checks.
 * A CANCELLED or NO_SHOW reservation frees its slot.
 */
export const ACTIVE_RESERVATION_STATUSES: readonly ReservationStatus[] = [
  'CONFIRMED',
  'SEATED',
] as const;

export function isActiveReservationStatus(s: string): s is ReservationStatus {
  return (ACTIVE_RESERVATION_STATUSES as readonly string[]).includes(s);
}

/**
 * French display label for the dashboard.
 * Always go through this map — never hardcode French strings in components.
 */
export const RESERVATION_STATUS_LABELS: Record<ReservationStatus, string> = {
  CONFIRMED: 'Confirmée',
  CANCELLED: 'Annulée',
  NO_SHOW: 'No-show',
  SEATED: 'Installée',
};

/**
 * Tailwind badge variant per status — kept as a string constant, not
 * a class import, to keep this package free of UI deps. Consumers
 * map variant → className in their own UI layer.
 */
export const RESERVATION_STATUS_VARIANT: Record<
  ReservationStatus,
  'success' | 'destructive' | 'warning' | 'default'
> = {
  CONFIRMED: 'success',
  CANCELLED: 'destructive',
  NO_SHOW: 'warning',
  SEATED: 'default',
};
