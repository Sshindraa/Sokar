/**
 * Contract de capacité partagé par les lecteurs réservation.
 *
 * `state` est la source de vérité agentic : les trois états ci-dessous sont
 * actifs. Une réservation ou un hold actif sans table consomme une capacité
 * globale conservatrice ; tant qu'aucun ledger de capacité restaurant n'existe,
 * l'intervalle entier est masqué plutôt que de risquer une sur-réservation.
 */
export const ACTIVE_RESERVATION_STATES = ['PENDING', 'CONFIRMED', 'SEATED'] as const;

export type ActiveReservationState = (typeof ACTIVE_RESERVATION_STATES)[number];

export function isActiveReservationState(
  state: string | null | undefined,
): state is ActiveReservationState {
  return (
    state !== undefined &&
    state !== null &&
    ACTIVE_RESERVATION_STATES.includes(state as ActiveReservationState)
  );
}

export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}
