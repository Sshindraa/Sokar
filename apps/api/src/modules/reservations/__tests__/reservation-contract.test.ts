import { describe, expect, it } from 'vitest';
import {
  compareReservationContractResults,
  runReservationShadowComparison,
} from '../contract-shadow-harness';
import { reservationContractFixtures } from './reservation-contract.fixtures';

describe('reservation contract reference fixtures', () => {
  it.each([
    ['voiceCreate', 'CONFIRMED', 'CONFIRMED', 'reserved'],
    ['dashboardCancel', 'CANCELLED', 'CANCELLED', 'released'],
    ['giftCardReservation', 'CONFIRMED', 'CONFIRMED', 'reserved'],
    ['mcpHoldConfirmCancel', 'CANCELLED', 'CANCELLED', 'released'],
    ['waitingListPromotion', 'CONFIRMED', 'CONFIRMED', 'reserved'],
    ['walkIn', 'SEATED', 'SEATED', 'reserved'],
    ['cancellationAfterHold', 'CANCELLED', 'CANCELLED', 'released'],
  ] as const)('%s conserve status/state et capacité', (key, status, state, capacity) => {
    const scenario = reservationContractFixtures[key];
    expect(scenario.snapshot).toMatchObject({ status, state, capacity });
  });

  it('conserve la projection PENDING/CONFIRMED tout en réservant la capacité', () => {
    expect(reservationContractFixtures.pendingManualValidation.snapshot).toMatchObject({
      status: 'CONFIRMED',
      state: 'PENDING',
      capacity: 'reserved',
      hold: 'consumed',
    });
  });

  it('Connect conserve le contrat hold puis confirm sans notification client', () => {
    const { hold, confirm } = reservationContractFixtures.connectHoldConfirm;

    expect(hold.snapshot).toMatchObject({
      status: null,
      state: null,
      idempotency: 'keyed',
      capacity: 'reserved',
      hold: 'active',
    });
    expect(confirm.snapshot).toMatchObject({
      status: 'CONFIRMED',
      state: 'CONFIRMED',
      auditEvents: ['hold_consumed', 'reservation_created'],
      notificationJobs: ['connect-analytics:reservation_confirmed'],
      hold: 'consumed',
    });
  });

  it('les retries ne dupliquent ni audit ni notification', () => {
    const retry = reservationContractFixtures.retrySameOperation.snapshot;

    expect(retry.outcome).toBe('reused');
    expect(retry.idempotency).toBe('reused');
    expect(retry.auditEvents).toEqual([]);
    expect(retry.notificationJobs).toEqual([]);
    expect(retry.capacity).toBe('unchanged');
  });

  it('un conflit de capacité ne commit ni réservation, ni audit, ni hold', () => {
    expect(reservationContractFixtures.capacityConflict.snapshot).toMatchObject({
      outcome: 'conflict',
      status: null,
      state: null,
      auditEvents: [],
      notificationJobs: [],
      capacity: 'conflict',
      hold: 'none',
    });
  });

  it('l’annulation après hold libère la capacité mais conserve la preuve du hold consommé', () => {
    expect(reservationContractFixtures.cancellationAfterHold.snapshot).toMatchObject({
      status: 'CANCELLED',
      state: 'CANCELLED',
      auditEvents: [
        'hold_consumed',
        'reservation_created',
        'hold_released',
        'reservation_cancelled',
      ],
      capacity: 'released',
      hold: 'consumed',
    });
  });
});

describe('reservation shadow comparator', () => {
  it('retourne equal pour deux sorties normalisées identiques', () => {
    const snapshot = reservationContractFixtures.voiceCreate.snapshot;
    const comparison = compareReservationContractResults(snapshot, snapshot);

    expect(comparison.equal).toBe(true);
    expect(comparison.differences).toEqual([]);
  });

  it('isole les différences legacy/agentic sans exécuter de provider', async () => {
    const comparison = await runReservationShadowComparison({
      legacy: async () => reservationContractFixtures.voiceCreate.snapshot,
      agentic: async () => reservationContractFixtures.giftCardReservation.snapshot,
    });

    expect(comparison.equal).toBe(false);
    expect(comparison.differences).toEqual(['auditEvents', 'notificationJobs', 'hold']);
    expect(comparison.legacy.status).toBe('CONFIRMED');
    expect(comparison.agentic.state).toBe('CONFIRMED');
  });
});
