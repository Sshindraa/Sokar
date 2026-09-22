import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma, ReservationPaymentStatus } from '@prisma/client';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { constructWebhookEvent } from '../../gift-cards/stripe.service';

const AUTH = { authorization: 'Bearer test' };

function policyRow() {
  return {
    id: 'policy-1',
    restaurantId: 'test-rest-1',
    version: 1,
    type: 'DEPOSIT',
    amountMode: 'PER_PERSON',
    amount: new Prisma.Decimal('15.00'),
    minPartySize: 2,
    cancellationHours: 24,
    rules: {},
    activeFrom: new Date('2026-09-01T00:00:00.000Z'),
    activeUntil: null,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

describe('reservation payment foundation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('RESERVATION_PAYMENTS_ENABLED', 'false');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'PRO' } as never);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeApp();
  });

  it('reste fermé par défaut avant la qualification du marchand', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/reservation-payment-policies',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: 'RESERVATION_PAYMENTS_DISABLED' });
  });

  it('refuse Essential avant même le flag runtime', async () => {
    vi.stubEnv('RESERVATION_PAYMENTS_ENABLED', 'true');
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({ plan: 'STARTER' } as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'GET',
      url: '/reservation-payment-policies',
      headers: AUTH,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe('CAPABILITY_NOT_INCLUDED');
  });

  it('prévisualise une policy et un montant sans appeler Stripe ni écrire', async () => {
    vi.stubEnv('RESERVATION_PAYMENTS_ENABLED', 'true');
    vi.mocked(db.reservation.findFirst).mockResolvedValue({
      id: 'reservation-1',
      restaurantId: 'test-rest-1',
      partySize: 3,
      status: 'CONFIRMED',
      state: 'CONFIRMED',
    } as never);
    vi.mocked(db.reservationPaymentPolicy.findFirst).mockResolvedValue(policyRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reservations/reservation-1/payment/prepare',
      headers: AUTH,
      payload: {
        idempotencyKey: 'payment-key-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      id: null,
      amount: '45.00',
      dryRun: true,
      providerConfigured: false,
      requiresProviderSetup: true,
    });
    expect(db.reservationPayment.create).not.toHaveBeenCalled();
  });

  it('enregistre une policy versionnée uniquement quand le flag est explicitement ouvert', async () => {
    vi.stubEnv('RESERVATION_PAYMENTS_ENABLED', 'true');
    vi.mocked(db.reservationPaymentPolicy.findFirst).mockResolvedValue(null);
    vi.mocked(db.reservationPaymentPolicy.create).mockResolvedValue(policyRow() as never);
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/reservation-payment-policies',
      headers: AUTH,
      payload: {
        type: 'DEPOSIT',
        amountMode: 'PER_PERSON',
        amount: '15.00',
        minPartySize: 2,
        cancellationHours: 24,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({ version: 1, amount: '15.00' });
    expect(JSON.stringify(response.json())).not.toContain('stripeAccountId');
  });

  it('accepte un événement Stripe signé déjà normalisé et confirme une réservation pending', async () => {
    vi.stubEnv('RESERVATION_PAYMENTS_ENABLED', 'true');
    vi.mocked(constructWebhookEvent).mockResolvedValueOnce({
      id: 'evt_payment_1',
      created: 1_789_000_000,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          amount: 2_500,
          currency: 'eur',
          metadata: {
            restaurantId: 'test-rest-1',
            reservationPaymentId: 'payment-1',
          },
        },
      },
    } as never);
    vi.mocked(db.reservationPaymentEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.reservationPayment.findFirst).mockResolvedValue({
      id: 'payment-1',
      restaurantId: 'test-rest-1',
      reservationId: 'reservation-1',
      policyId: 'policy-1',
      status: ReservationPaymentStatus.REQUIRES_PAYMENT_METHOD,
      amount: new Prisma.Decimal('25.00'),
      currency: 'EUR',
      stripeAccountId: null,
      stripeSetupIntentId: null,
      stripePaymentIntentId: null,
      idempotencyKey: 'payment-key-1',
      policySnapshot: {},
      expiresAt: new Date('2026-09-14T12:00:00.000Z'),
      failureCode: null,
      lastProviderEventAt: null,
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    } as never);
    vi.mocked(db.reservationPayment.update).mockResolvedValue({
      id: 'payment-1',
      restaurantId: 'test-rest-1',
      reservationId: 'reservation-1',
      policyId: 'policy-1',
      status: ReservationPaymentStatus.CAPTURED,
      amount: new Prisma.Decimal('25.00'),
      currency: 'EUR',
      stripeAccountId: null,
      stripeSetupIntentId: null,
      stripePaymentIntentId: 'pi_1',
      idempotencyKey: 'payment-key-1',
      policySnapshot: {},
      expiresAt: new Date('2026-09-14T12:00:00.000Z'),
      failureCode: null,
      lastProviderEventAt: new Date('2026-09-14T10:00:00.000Z'),
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
      updatedAt: new Date('2026-09-14T10:00:00.000Z'),
    } as never);
    vi.mocked(db.reservationPaymentEvent.create).mockResolvedValue({
      id: 'event-1',
      paymentId: 'payment-1',
      resultingStatus: ReservationPaymentStatus.CAPTURED,
    } as never);
    vi.mocked(db.reservation.findUnique).mockResolvedValue({
      id: 'reservation-1',
      restaurantId: 'test-rest-1',
      partySize: 2,
      customerName: 'Test customer',
      customerPhone: null,
      reservedAt: new Date('2026-09-14T10:00:00.000Z'),
      startsAt: new Date('2026-09-14T10:00:00.000Z'),
      endsAt: new Date('2026-09-14T12:00:00.000Z'),
      tableId: null,
      status: 'CONFIRMED',
      state: 'PENDING',
      consumedHoldId: null,
    } as never);
    vi.mocked(db.reservation.update).mockResolvedValue({
      id: 'reservation-1',
      restaurantId: 'test-rest-1',
      status: 'CONFIRMED',
      state: 'CONFIRMED',
    } as never);
    vi.mocked(db.reservationAuditLog.create).mockResolvedValue({ id: 'audit-1' } as never);

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe/reservation-payments',
      headers: { 'stripe-signature': 't=1,v1=test', 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      received: true,
      resultingStatus: 'CAPTURED',
      reservationConfirmed: true,
    });
  });
});
