import {
  reservationContractObservationsTotal,
  reservationMutationsTotal,
  reservationStatusStateMismatchesTotal,
} from './metrics';
import { logger } from '../logger/pino';

/**
 * Vocabulaire volontairement fermé pour les métriques de contrat réservation.
 * Ces valeurs sont des catégories techniques, jamais des identifiants métier.
 */
export const RESERVATION_OBSERVATION_SOURCES = [
  'legacy_service',
  'agentic_service',
  'voice',
  'connect',
  'dashboard',
  'mcp',
  'openai_reserve',
  'generic_agent',
  'gift_card',
  'waiting_list',
  'walk_in',
  'copilot',
  'worker',
  'direct',
  'rgpd',
  'script',
] as const;

export type ReservationObservationSource = (typeof RESERVATION_OBSERVATION_SOURCES)[number];

export const RESERVATION_OBSERVATION_OPERATIONS = [
  'create',
  'create_replay',
  'update',
  'cancel',
  'delete',
  'allocate',
  'allocate_replay',
  'transition',
  'promote',
  'promote_replay',
  'reallocate',
  'release',
  'recovery_update',
  'recovery_create',
  'revert_update',
  'revert_cancel',
  'confirmation',
  'confirmation_reply',
  'source_patch',
  'anonymize',
] as const;

export type ReservationObservationOperation = (typeof RESERVATION_OBSERVATION_OPERATIONS)[number];

export type ReservationIdempotencyObservation = 'keyed' | 'reused' | 'unkeyed' | 'not_applicable';

export type ReservationAuditObservation = 'written' | 'not_written' | 'not_applicable';

export type ReservationNotificationObservation =
  | 'queued'
  | 'direct'
  | 'failed'
  | 'not_sent'
  | 'not_applicable';

export type ReservationCapacityObservation =
  | 'reserved'
  | 'released'
  | 'unchanged'
  | 'conflict'
  | 'not_released'
  | 'not_applicable';

export type ReservationMutationObservation = {
  source: ReservationObservationSource;
  operation: ReservationObservationOperation;
  /** Snapshot disponible sans nouvelle lecture DB. */
  status?: string | null;
  state?: string | null;
  idempotency: ReservationIdempotencyObservation;
  audit: ReservationAuditObservation;
  notification: ReservationNotificationObservation;
  capacity: ReservationCapacityObservation;
  /** false pour un replay qui ne modifie pas la base. */
  mutated?: boolean;
};

type ContractObservationType =
  | 'status_state_match'
  | 'status_state_pending_projection'
  | 'status_state_unmapped'
  | 'status_state_mismatch'
  | 'idempotency_keyed'
  | 'idempotency_reused'
  | 'idempotency_unkeyed'
  | 'audit_written'
  | 'audit_missing'
  | 'notification_queued'
  | 'notification_direct'
  | 'notification_failed'
  | 'notification_not_sent'
  | 'capacity_reserved'
  | 'capacity_released'
  | 'capacity_unchanged'
  | 'capacity_conflict'
  | 'capacity_not_released';

const STATUS_FOR_STATE: Record<string, string | undefined> = {
  CONFIRMED: 'CONFIRMED',
  SEATED: 'SEATED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  PENDING: undefined,
  HONORED: undefined,
  FAILED: undefined,
  EXPIRED: undefined,
};

const CAPACITY_BLOCKING_STATES = new Set(['PENDING', 'CONFIRMED', 'SEATED']);

function statusStateObservation(
  status: string | null | undefined,
  state: string | null | undefined,
): Extract<
  ContractObservationType,
  | 'status_state_match'
  | 'status_state_pending_projection'
  | 'status_state_unmapped'
  | 'status_state_mismatch'
> | null {
  if (status == null || state == null) return null;

  if (state === 'PENDING' && status === 'CONFIRMED') {
    return 'status_state_pending_projection';
  }

  const expectedStatus = STATUS_FOR_STATE[state];
  if (expectedStatus === undefined && state in STATUS_FOR_STATE) {
    return 'status_state_unmapped';
  }
  return expectedStatus === status ? 'status_state_match' : 'status_state_mismatch';
}

function recordContractObservation(
  observation: ReservationMutationObservation,
  type: ContractObservationType,
): void {
  reservationContractObservationsTotal.inc({
    source: observation.source,
    operation: observation.operation,
    mismatch_type: type,
  });
}

/**
 * Enregistre une observation sans jamais faire échouer la mutation métier.
 * La fonction n'effectue aucune lecture/écriture DB et n'ajoute aucun label à
 * cardinalité non bornée.
 */
export function observeReservationMutation(observation: ReservationMutationObservation): void {
  try {
    if (observation.mutated !== false) {
      reservationMutationsTotal.inc({
        source: observation.source,
        operation: observation.operation,
      });
    }

    const statusStateType = statusStateObservation(observation.status, observation.state);
    if (statusStateType) {
      recordContractObservation(observation, statusStateType);
      if (statusStateType !== 'status_state_match') {
        reservationStatusStateMismatchesTotal.inc({
          source: observation.source,
          operation: observation.operation,
          mismatch_type: statusStateType,
        });
        logger.warn(
          {
            source: observation.source,
            operation: observation.operation,
            status: observation.status,
            state: observation.state,
            mismatchType: statusStateType,
          },
          'reservation status/state contract observation',
        );
      }
    }

    if (observation.idempotency !== 'not_applicable') {
      recordContractObservation(
        observation,
        `idempotency_${observation.idempotency}` as Extract<
          ContractObservationType,
          'idempotency_keyed' | 'idempotency_reused' | 'idempotency_unkeyed'
        >,
      );
    }

    if (observation.audit !== 'not_applicable') {
      recordContractObservation(
        observation,
        observation.audit === 'written' ? 'audit_written' : 'audit_missing',
      );
    }

    if (observation.notification !== 'not_applicable') {
      recordContractObservation(
        observation,
        `notification_${observation.notification}` as Extract<
          ContractObservationType,
          | 'notification_queued'
          | 'notification_direct'
          | 'notification_failed'
          | 'notification_not_sent'
        >,
      );
    }

    if (observation.capacity !== 'not_applicable') {
      recordContractObservation(
        observation,
        `capacity_${observation.capacity}` as Extract<
          ContractObservationType,
          | 'capacity_reserved'
          | 'capacity_released'
          | 'capacity_unchanged'
          | 'capacity_conflict'
          | 'capacity_not_released'
        >,
      );
    }
  } catch (err) {
    // L'observabilité ne doit jamais modifier le résultat ni le rollback d'une
    // opération de réservation.
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      'reservation contract observation failed',
    );
  }
}

/**
 * Déduit une catégorie stable à partir des acteurs déjà présents dans le
 * code. Les valeurs complètes (clientId, restaurantId, etc.) ne sortent pas
 * de cette fonction et ne deviennent jamais des labels Prometheus.
 */
export function inferReservationObservationSource(
  actor?: string | null,
  channel?: string | null,
): ReservationObservationSource {
  if (actor?.startsWith('connect:')) return 'connect';
  if (actor?.startsWith('gift-card:')) return 'gift_card';
  if (actor?.startsWith('voice:')) return 'voice';
  if (actor?.startsWith('waiting-list')) return 'waiting_list';
  if (actor?.startsWith('walk-in')) return 'walk_in';
  if (actor?.startsWith('copilot') || actor?.startsWith('service-copilot')) return 'copilot';
  if (actor?.startsWith('staff:dashboard') || actor === 'dashboard') return 'dashboard';
  if (actor?.startsWith('generic-agent:')) return 'generic_agent';
  if (actor?.startsWith('agent:')) {
    return channel === 'OPENAI_RESERVE' ? 'openai_reserve' : 'mcp';
  }
  if (actor?.startsWith('system:')) return 'worker';
  if (channel === 'OPENAI_RESERVE') return 'openai_reserve';
  return 'agentic_service';
}

/** Effet de capacité d'une transition, calculé à partir des états déjà lus. */
export function reservationCapacityEffect(
  fromState: string | null | undefined,
  toState: string | null | undefined,
): ReservationCapacityObservation {
  if (!fromState || !toState) return 'unchanged';
  const wasBlocking = CAPACITY_BLOCKING_STATES.has(fromState);
  const isBlocking = CAPACITY_BLOCKING_STATES.has(toState);
  if (!wasBlocking && isBlocking) return 'reserved';
  if (wasBlocking && !isBlocking) return 'released';
  return 'unchanged';
}
