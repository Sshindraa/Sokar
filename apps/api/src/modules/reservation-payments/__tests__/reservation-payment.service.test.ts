import { Prisma, ReservationPaymentStatus, ReservationPaymentType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import {
  applyReservationPaymentProviderEvent,
  computeReservationPaymentAmount,
  prepareReservationPayment,
  reservationPaymentStatusForProviderEvent,
} from '../reservation-payment.service';

const RESTAURANT_ID = 'restaurant-1';
const RESERVATION_ID = 'reservation-1';
const POLICY_ID = 'policy-1';
const NOW = new Date('2026-09-14T10:00:00.000Z');

function policyRow() {
  return {
    id: POLICY_ID,
    restaurantId: RESTAURANT_ID,
    version: 1,
    type: ReservationPaymentType.DEPOSIT,
    amountMode: 'PER_PERSON',
    amount: new Prisma.Decimal('12.50'),
    minPartySize: 2,
    cancellationHours: 24,
    rules: {},
    activeFrom: new Date('2026-09-01T00:00:00.000Z'),
    activeUntil: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

function paymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'payment-1',
    restaurantId: RESTAURANT_ID,
    reservationId: RESERVATION_ID,
    policyId: POLICY_ID,
    status: ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD,
    amount: new Prisma.Decimal('25.00'),
    currency: 'EUR',
    stripeAccountId: null,
    stripeSetupIntentId: null,
    stripePaymentIntentId: null,
    idempotencyKey: 'payment-key-1',
    policySnapshot: {},
    expiresAt: new Date('2026-09-14T10:30:00.000Z'),
    failureCode: null,
    lastProviderEventAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('reservation payment foundation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESERVATION_PAYMENTS_ENABLED = 'true';
  });

  it('calcule un acompte par personne avec deux décimales', () => {
    const amount = computeReservationPaymentAmount(
      { amount: new Prisma.Decimal('12.50'), amountMode: 'PER_PERSON' },
      4,
    );
    expect(amount.toFixed(2)).toBe('50.00');
  });

  it('mappe uniquement les événements provider connus', () => {
    expect(reservationPaymentStatusForProviderEvent('payment_intent.succeeded')).toBe(
      ReservationPaymentStatus.CAPTURED,
    );
    expect(reservationPaymentStatusForProviderEvent('customer.created')).toBeNull();
  });

  it('reste en dry-run par défaut et ne crée aucune ligne', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: RESERVATION_ID,
      restaurantId: RESTAURANT_ID,
      partySize: 2,
      status: 'CONFIRMED',
      state: 'CONFIRMED',
    } as never);
    vi.mocked(db.reservationPaymentPolicy.findFirst).mockResolvedValue(policyRow() as never);

    const result = await prepareReservationPayment({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      idempotencyKey: 'payment-key-1',
      now: NOW,
    });

    expect(result).toMatchObject({
      id: null,
      amount: '25.00',
      dryRun: true,
      providerConfigured: false,
      requiresProviderSetup: true,
    });
    expect(db.reservationPayment.create).not.toHaveBeenCalled();
  });

  it('réutilise une préparation commitée avec la même clé d’idempotence', async () => {
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: RESERVATION_ID,
      restaurantId: RESTAURANT_ID,
      partySize: 2,
      status: 'CONFIRMED',
      state: 'CONFIRMED',
    } as never);
    vi.mocked(db.reservationPaymentPolicy.findFirst).mockResolvedValue(policyRow() as never);
    const stored = paymentRow();
    vi.mocked(db.reservationPayment.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored as never);
    vi.mocked(db.reservationPayment.create).mockResolvedValue(stored as never);

    const first = await prepareReservationPayment({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      idempotencyKey: 'payment-key-1',
      now: NOW,
      dryRun: false,
    });
    const replay = await prepareReservationPayment({
      restaurantId: RESTAURANT_ID,
      reservationId: RESERVATION_ID,
      idempotencyKey: 'payment-key-1',
      now: NOW,
      dryRun: false,
    });

    expect(first).toMatchObject({ id: 'payment-1', status: 'REQUIRES_PAYMENT_METHOD' });
    expect(replay).toMatchObject({ id: 'payment-1', status: 'REQUIRES_PAYMENT_METHOD' });
    expect(db.reservationPayment.create).toHaveBeenCalledTimes(1);
  });

  it('traite un webhook succès une seule fois et confirme une réservation pending', async () => {
    const pending = paymentRow({
      status: ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD,
      lastProviderEventAt: null,
    });
    const captured = paymentRow({
      status: ReservationPaymentStatus.CAPTURED,
      stripePaymentIntentId: 'pi_123',
      lastProviderEventAt: new Date('2026-09-14T10:01:00.000Z'),
    });
    vi.mocked(db.reservationPaymentEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.reservationPayment.findFirst).mockResolvedValue(pending as never);
    vi.mocked(db.reservationPayment.update).mockResolvedValue(captured as never);
    vi.mocked(db.reservationPaymentEvent.create).mockResolvedValue({
      id: 'event-1',
      paymentId: 'payment-1',
      resultingStatus: ReservationPaymentStatus.CAPTURED,
    } as never);
    vi.mocked(db.reservation.findUnique).mockResolvedValue({
      id: RESERVATION_ID,
      restaurantId: RESTAURANT_ID,
      partySize: 2,
      customerName: 'Test customer',
      customerPhone: null,
      reservedAt: NOW,
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000),
      tableId: null,
      status: 'CONFIRMED',
      state: 'PENDING',
      consumedHoldId: null,
    } as never);
    vi.mocked(db.reservation.update).mockResolvedValue({
      id: RESERVATION_ID,
      restaurantId: RESTAURANT_ID,
      status: 'CONFIRMED',
      state: 'CONFIRMED',
    } as never);
    vi.mocked(db.reservationAuditLog.create).mockResolvedValue({ id: 'audit-1' } as never);

    const result = await applyReservationPaymentProviderEvent({
      restaurantId: RESTAURANT_ID,
      paymentId: 'payment-1',
      providerEventId: 'evt_123',
      eventType: 'payment_intent.succeeded',
      occurredAt: new Date('2026-09-14T10:01:00.000Z'),
      payloadHash: 'a'.repeat(64),
      amount: '25.00',
      currency: 'EUR',
      stripePaymentIntentId: 'pi_123',
    });

    expect(result).toMatchObject({
      eventId: 'event-1',
      resultingStatus: ReservationPaymentStatus.CAPTURED,
      changed: true,
      reservationConfirmed: true,
    });
    expect(db.reservation.update).toHaveBeenCalledWith({
      where: { id: RESERVATION_ID, restaurantId: RESTAURANT_ID },
      data: { state: 'CONFIRMED', status: 'CONFIRMED' },
    });
    expect(db.reservationAuditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        event: 'reservation_confirmed',
        fromState: 'PENDING',
        toState: 'CONFIRMED',
      }),
    });
  });
});
