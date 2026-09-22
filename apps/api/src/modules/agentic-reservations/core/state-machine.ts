/**
 * Compatibilité de module pour les imports historiques du domaine agentic.
 * La state machine est désormais partagée avec le chemin legacy.
 */
export {
  AGENTIC_CHANNELS,
  InvalidStateInvariantError,
  InvalidStateTransitionError,
  RESERVATION_CHANNELS,
  RESERVATION_STATES,
  assertCanTransition,
  canTransition,
  isAgenticChannel,
  isTerminalState,
  listAllowedTransitions,
} from '../../../shared/reservations/reservation-state-machine.js';
export type {
  ReservationChannel,
  ReservationState,
  ReservationStateContext,
} from '../../../shared/reservations/reservation-state-machine.js';
