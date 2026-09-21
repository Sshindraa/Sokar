import type { ReservationState, ReservationStatus } from '@prisma/client';

/**
 * Projection canonique entre `Reservation.state` et `Reservation.status`.
 *
 * La table `reservations` porte deux colonnes pour le même état métier :
 *
 * - `state` (huit valeurs) est la source de vérité des parcours agentic ;
 * - `status` (quatre valeurs) est l'énumération historique lue par le
 *   dashboard, la voix et le pipeline de confirmation.
 *
 * `status` est une projection **lossy** de `state` : `PENDING`, `HONORED`,
 * `FAILED` et `EXPIRED` n'ont pas d'équivalent dans l'énumération historique,
 * donc la colonne conserve la dernière valeur projetée. Un lecteur qui teste
 * `status === 'CONFIRMED'` seul peut donc prendre pour ferme une réservation
 * `state = PENDING` (validation manuelle en attente) ou `state = HONORED`
 * (client déjà installé). Ces deux cas se sont produits : le worker de rappel
 * a dû ajouter un second test, et le handler de réponse SMS ne l'avait pas.
 *
 * Avant ce module, la correspondance existait en trois exemplaires
 * (`modules/reservations/reservation.service.ts`,
 * `modules/agentic-reservations/core/reservation.service.ts` et
 * `shared/observability/reservation-contract.ts`) et rien ne garantissait
 * qu'elles restaient d'accord. C'est le point de divergence visé par R1-4.
 */

/**
 * Projeté vers l'énumération historique. `null` signifie « aucun équivalent » :
 * l'appelant doit alors conserver la valeur précédente plutôt que d'inventer un
 * statut. Ne jamais transformer ce `null` en `CONFIRMED`.
 */
export const STATUS_FOR_STATE: Readonly<Record<ReservationState, ReservationStatus | null>> = {
  PENDING: null,
  CONFIRMED: 'CONFIRMED',
  SEATED: 'SEATED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  HONORED: null,
  FAILED: null,
  EXPIRED: null,
};

/**
 * Projection inverse, totale sur les quatre valeurs historiques. C'est elle qui
 * garantit qu'une écriture legacy (`status`) renseigne `state` de façon
 * déterministe au lieu de s'en remettre au défaut Prisma.
 */
export const STATE_FOR_STATUS: Readonly<Record<ReservationStatus, ReservationState>> = {
  CONFIRMED: 'CONFIRMED',
  SEATED: 'SEATED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
};

export function statusForState(state: ReservationState): ReservationStatus | null {
  return STATUS_FOR_STATE[state];
}

export function stateForStatus(status: ReservationStatus): ReservationState {
  return STATE_FOR_STATUS[status];
}

const RESERVATION_STATE_VALUES = new Set<string>(Object.keys(STATUS_FOR_STATE));

export function isReservationState(value: unknown): value is ReservationState {
  return typeof value === 'string' && RESERVATION_STATE_VALUES.has(value);
}

/**
 * Prédicat unique « cette réservation est ferme côté client ».
 *
 * Les deux colonnes sont exigées : `state` porte la vérité métier, `status`
 * détecte une ligne dérivée par un chemin qui aurait écrit `status` seul. Un
 * `state = CONFIRMED` accompagné d'un `status = CANCELLED` ne doit déclencher
 * ni rappel client ni annulation par réponse SMS.
 */
export function isConfirmedReservation(reservation: {
  status: string | null | undefined;
  state: string | null | undefined;
}): boolean {
  return reservation.status === 'CONFIRMED' && reservation.state === 'CONFIRMED';
}

/**
 * États qu'une création peut légitimement produire. `HONORED`, `NO_SHOW`,
 * `CANCELLED`, `FAILED` et `EXPIRED` décrivent une fin de vie : ils s'obtiennent
 * par transition, jamais à la naissance de la ligne.
 */
export type CreatableReservationState = Extract<
  ReservationState,
  'PENDING' | 'CONFIRMED' | 'SEATED'
>;

/**
 * Projection à utiliser à la création, quand il n'existe aucun état précédent à
 * conserver. Une réservation créée en `PENDING` n'est pas annulée : l'énumération
 * historique ne sait pas exprimer « en attente de validation », donc `status`
 * porte `CONFIRMED` et c'est `state` qui tranche — voir `isConfirmedReservation`.
 * Écrire ces deux colonnes à la main à chaque `reservation.create` laissait la
 * règle implicite et recopiée (R1-4).
 */
export function creationProjection(state: CreatableReservationState): {
  state: CreatableReservationState;
  status: ReservationStatus;
} {
  return { state, status: statusForState(state) ?? 'CONFIRMED' };
}

/**
 * Projection d'une transition. `status` ne peut pas toujours suivre `state` :
 * quand l'état cible n'a pas d'équivalent historique (`PENDING`, `HONORED`,
 * `FAILED`, `EXPIRED`), la colonne conserve le statut précédent. Retomber sur
 * `CONFIRMED` écraserait par exemple une annulation déjà enregistrée.
 */
export function transitionProjection(
  toState: ReservationState,
  previousStatus: ReservationStatus,
): { state: ReservationState; status: ReservationStatus } {
  return { state: toState, status: statusForState(toState) ?? previousStatus };
}
