/**
 * State machine pour Reservation.
 *
 * Pure logic : aucune dépendance à Prisma, Redis, ou au réseau.
 * Tous les tests peuvent s'exécuter sans DB.
 *
 * La state machine est l'autorité unique pour décider si une transition
 * est valide. Tout service qui mute une réservation DOIT passer par
 * `assertCanTransition` avant d'écrire en DB.
 */

export const RESERVATION_STATES = [
  'PENDING',
  'CONFIRMED',
  'SEATED',
  'HONORED',
  'CANCELLED',
  'NO_SHOW',
  'FAILED',
  'EXPIRED',
] as const;

export type ReservationState = (typeof RESERVATION_STATES)[number];

export const RESERVATION_CHANNELS = [
  'PHONE',
  'WEB',
  'MCP',
  'OPENAI_RESERVE',
  'ADMIN',
  'API',
] as const;

export type ReservationChannel = (typeof RESERVATION_CHANNELS)[number];

/**
 * Transitions valides.
 *
 *   PENDING   → CONFIRMED | CANCELLED | EXPIRED | FAILED
 *   CONFIRMED → SEATED | CANCELLED | NO_SHOW | EXPIRED | FAILED
 *   SEATED    → HONORED | NO_SHOW
 *   HONORED   → (terminal)
 *   CANCELLED → (terminal)
 *   NO_SHOW   → (terminal)
 *   FAILED    → (terminal)
 *   EXPIRED   → (terminal)
 *
 * Le rôle de PENDING est la validation manuelle (`requireManualValidation`).
 * Une résa CANCELLED/NO_SHOW/FAILED/EXPIRED/HONORED est terminale : aucune
 * transition autorisée.
 */
const VALID_TRANSITIONS: Readonly<Record<ReservationState, ReadonlySet<ReservationState>>> = {
  PENDING: new Set(['CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED']),
  CONFIRMED: new Set(['SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'FAILED']),
  SEATED: new Set(['HONORED', 'NO_SHOW']),
  HONORED: new Set(),
  CANCELLED: new Set(),
  NO_SHOW: new Set(),
  FAILED: new Set(),
  EXPIRED: new Set(),
};

export class InvalidStateTransitionError extends Error {
  public readonly from: ReservationState;
  public readonly to: ReservationState;

  constructor(from: ReservationState, to: ReservationState) {
    super(`Invalid state transition: ${from} → ${to}`);
    this.name = 'InvalidStateTransitionError';
    this.from = from;
    this.to = to;
  }
}

export class InvalidStateInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidStateInvariantError';
  }
}

export type ReservationStateContext = {
  tableId?: string | null;
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export function isTerminalState(state: ReservationState): boolean {
  return VALID_TRANSITIONS[state].size === 0;
}

export function canTransition(from: ReservationState, to: ReservationState): boolean {
  return VALID_TRANSITIONS[from].has(to);
}

export function assertCanTransition(
  from: ReservationState,
  to: ReservationState,
  context?: ReservationStateContext,
  now = new Date(),
): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(from, to);
  }
  validateStateInvariants(to, context, now);
}

function validateStateInvariants(
  to: ReservationState,
  context?: ReservationStateContext,
  now = new Date(),
): void {
  if (!context) return;

  if (to === 'SEATED' && !context.tableId) {
    throw new InvalidStateInvariantError('SEATED requires a tableId');
  }

  if (
    (to === 'HONORED' || to === 'NO_SHOW') &&
    (!context.startsAt || context.startsAt.getTime() > now.getTime())
  ) {
    throw new InvalidStateInvariantError(`${to} requires a startsAt in the past`);
  }
}

export function listAllowedTransitions(from: ReservationState): ReservationState[] {
  return [...VALID_TRANSITIONS[from]];
}

/**
 * Identifie les canaux agentic qui exigent une clé d'idempotence.
 * Les canaux legacy (PHONE, WEB, ADMIN) peuvent créer des résas sans
 * idempotency_key, mais l'API externe (API, MCP, OPENAI_RESERVE) l'exige.
 */
export const AGENTIC_CHANNELS: ReadonlySet<ReservationChannel> = new Set([
  'API',
  'MCP',
  'OPENAI_RESERVE',
]);

export function isAgenticChannel(channel: ReservationChannel): boolean {
  return AGENTIC_CHANNELS.has(channel);
}
