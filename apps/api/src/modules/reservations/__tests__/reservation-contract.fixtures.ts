import {
  normalizeReservationContractResult,
  type ReservationContractSnapshot,
} from '../contract-shadow-harness';

export type ReservationContractFixture = {
  name: string;
  snapshot: ReservationContractSnapshot;
};

function fixture(
  name: string,
  input: Partial<ReservationContractSnapshot>,
): ReservationContractFixture {
  return { name, snapshot: normalizeReservationContractResult(input) };
}

/**
 * Oracle déterministe issue de la cartographie Phase 2 et de la lecture du
 * code Phase 3A. Ces fixtures décrivent le contrat observé; elles ne lancent
 * ni Prisma, ni Redis, ni un provider de notification.
 */
export const reservationContractFixtures = {
  connectHoldConfirm: {
    hold: fixture('connect hold', {
      outcome: 'committed',
      idempotency: 'keyed',
      auditEvents: ['hold_created'],
      notificationJobs: ['connect-analytics:reservation_hold_created'],
      capacity: 'reserved',
      hold: 'active',
    }),
    confirm: fixture('connect confirm', {
      outcome: 'committed',
      status: 'CONFIRMED',
      state: 'CONFIRMED',
      idempotency: 'keyed',
      auditEvents: ['hold_consumed', 'reservation_created'],
      notificationJobs: ['connect-analytics:reservation_confirmed'],
      capacity: 'reserved',
      hold: 'consumed',
    }),
  },

  voiceCreate: fixture('voice create', {
    outcome: 'committed',
    status: 'CONFIRMED',
    state: 'CONFIRMED',
    idempotency: 'keyed',
    auditEvents: [],
    notificationJobs: ['sms-client:client-confirm'],
    capacity: 'reserved',
    hold: 'none',
  }),

  pendingManualValidation: fixture('pending manual validation', {
    outcome: 'committed',
    status: 'CONFIRMED',
    state: 'PENDING',
    idempotency: 'keyed',
    auditEvents: ['hold_consumed', 'reservation_created'],
    notificationJobs: [],
    capacity: 'reserved',
    hold: 'consumed',
  }),

  dashboardCancel: fixture('dashboard cancel', {
    outcome: 'committed',
    status: 'CANCELLED',
    state: 'CANCELLED',
    idempotency: 'not_applicable',
    auditEvents: ['reservation_cancelled'],
    notificationJobs: [],
    capacity: 'released',
    hold: 'none',
  }),

  giftCardReservation: fixture('gift card reservation', {
    outcome: 'committed',
    status: 'CONFIRMED',
    state: 'CONFIRMED',
    idempotency: 'keyed',
    auditEvents: ['hold_consumed', 'reservation_created'],
    notificationJobs: [],
    capacity: 'reserved',
    hold: 'consumed',
  }),

  mcpHoldConfirmCancel: fixture('MCP hold confirm cancel', {
    outcome: 'committed',
    status: 'CANCELLED',
    state: 'CANCELLED',
    idempotency: 'keyed',
    auditEvents: [
      'hold_created',
      'hold_consumed',
      'reservation_created',
      'hold_released',
      'reservation_cancelled',
    ],
    notificationJobs: [],
    capacity: 'released',
    // Le cancel agentic audite hold_released mais laisse le hold CONSUMED.
    hold: 'consumed',
  }),

  waitingListPromotion: fixture('waiting list promotion', {
    outcome: 'committed',
    status: 'CONFIRMED',
    state: 'CONFIRMED',
    idempotency: 'unkeyed',
    auditEvents: ['waiting_list_promoted'],
    notificationJobs: ['waiting-list-promote:sms', 'waiting-list-promote:email'],
    capacity: 'reserved',
    hold: 'none',
  }),

  walkIn: fixture('walk-in', {
    outcome: 'committed',
    status: 'SEATED',
    state: 'SEATED',
    idempotency: 'keyed',
    auditEvents: ['reservation_seated'],
    notificationJobs: [],
    capacity: 'reserved',
    hold: 'none',
  }),

  retrySameOperation: fixture('retry same operation', {
    outcome: 'reused',
    status: 'CONFIRMED',
    state: 'CONFIRMED',
    idempotency: 'reused',
    auditEvents: [],
    notificationJobs: [],
    capacity: 'unchanged',
    hold: 'consumed',
  }),

  capacityConflict: fixture('capacity conflict', {
    outcome: 'conflict',
    idempotency: 'keyed',
    auditEvents: [],
    notificationJobs: [],
    capacity: 'conflict',
    hold: 'none',
  }),

  cancellationAfterHold: fixture('cancellation after hold', {
    outcome: 'committed',
    status: 'CANCELLED',
    state: 'CANCELLED',
    idempotency: 'keyed',
    auditEvents: ['hold_consumed', 'reservation_created', 'hold_released', 'reservation_cancelled'],
    notificationJobs: [],
    capacity: 'released',
    hold: 'consumed',
  }),
} as const;
