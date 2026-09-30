/**
 * Tests for the Stripe gift-card service.
 *
 * setup.ts mocke le module `stripe.service` avec des vi.fn()s. On le
 * démocke pour exécuter la vraie implémentation, qui s'appuie sur le
 * mock du SDK Stripe (également défini dans setup.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stripe.service', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual };
});

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  retrieve: vi.fn(),
  refundCreate: vi.fn(),
  refundRetrieve: vi.fn(),
  refundList: vi.fn(),
}));

vi.mock('stripe', () => {
  let shouldThrow = false;

  class Stripe {
    paymentIntents = {
      create: sdk.create.mockResolvedValue({ id: 'pi_test', client_secret: 'pi_t_s' }),
      retrieve: sdk.retrieve.mockResolvedValue({
        id: 'pi_test',
        status: 'succeeded',
        amount: 10000,
        amount_received: 10000,
        application_fee_amount: 500,
        currency: 'eur',
        metadata: { restaurantId: 'rest-1', amount: '100' },
      }),
    };
    refunds = {
      create: sdk.refundCreate.mockResolvedValue({
        id: 're_test',
        amount: 2500,
        status: 'succeeded',
      }),
      retrieve: sdk.refundRetrieve,
      list: sdk.refundList.mockResolvedValue({ data: [], has_more: false }),
    };
    webhooks = {
      constructEvent: vi.fn().mockImplementation(() => {
        if (shouldThrow) {
          throw new Error('invalid signature');
        }
        return {
          type: 'payment_intent.succeeded',
          data: { object: { id: 'pi_test', status: 'succeeded' } },
        };
      }),
    };

    static setWebhookShouldThrow(value: boolean) {
      shouldThrow = value;
    }
  }

  return {
    default: Stripe,
    __setWebhookShouldThrow: (value: boolean) => {
      shouldThrow = value;
    },
  };
});

import Stripe from 'stripe';
import {
  createPaymentIntent,
  retrievePaymentIntent,
  constructWebhookEvent,
  createRefund,
} from '../stripe.service';

describe('stripe.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (
      Stripe as unknown as { setWebhookShouldThrow?: (value: boolean) => void }
    ).setWebhookShouldThrow?.(false);
  });

  function setWebhookSecret(value: string | undefined) {
    const envKey = 'STRIPE_WEBHOOK_SECRET';
    if (value === undefined) {
      delete process.env[envKey];
    } else {
      process.env[envKey] = value;
    }
  }

  describe('createPaymentIntent', () => {
    it('crée un payment intent et retourne id + clientSecret', async () => {
      const result = await createPaymentIntent({
        amount: 10000,
        currency: 'eur',
        metadata: { restaurantId: 'rest-1' },
      });

      expect(result.id).toBe('pi_test');
      expect(result.clientSecret).toBe('pi_t_s');
    });
  });

  describe('retrievePaymentIntent', () => {
    it("récupère le statut d'un payment intent", async () => {
      const result = await retrievePaymentIntent('pi_test');

      expect(result.id).toBe('pi_test');
      expect(result.status).toBe('succeeded');
      expect(result.amount).toBe(10000);
      expect(result.amountReceived).toBe(10000);
      expect(result.currency).toBe('eur');
      expect(result.metadata.restaurantId).toBe('rest-1');
    });
  });

  describe('constructWebhookEvent', () => {
    it('construit et vérifie un event Stripe depuis le webhook', async () => {
      const event = await constructWebhookEvent('raw-payload', 't=signature');

      expect(event.type).toBe('payment_intent.succeeded');
    });

    it('retourne erreur si STRIPE_WEBHOOK_SECRET est manquant', async () => {
      const previous = process.env.STRIPE_WEBHOOK_SECRET;
      setWebhookSecret(undefined);
      try {
        await expect(constructWebhookEvent('raw-payload', 't=signature')).rejects.toThrow(
          'STRIPE_WEBHOOK_SECRET is required',
        );
      } finally {
        setWebhookSecret(previous);
      }
    });

    it('fonctionne avec plusieurs secrets webhook séparés par des virgules', async () => {
      const previous = process.env.STRIPE_WEBHOOK_SECRET;
      setWebhookSecret('whsec_a,whsec_b');
      try {
        const event = await constructWebhookEvent('raw-payload', 't=signature');
        expect(event.type).toBe('payment_intent.succeeded');
      } finally {
        setWebhookSecret(previous);
      }
    });

    it('retourne erreur quand tous les secrets de la liste échouent', async () => {
      const previousSecret = process.env.STRIPE_WEBHOOK_SECRET;
      setWebhookSecret('whsec_a,whsec_b');
      (
        Stripe as unknown as { setWebhookShouldThrow?: (value: boolean) => void }
      ).setWebhookShouldThrow?.(true);
      try {
        await expect(constructWebhookEvent('raw-payload', 't=signature')).rejects.toThrow(
          'invalid signature',
        );
      } finally {
        setWebhookSecret(previousSecret);
        (
          Stripe as unknown as { setWebhookShouldThrow?: (value: boolean) => void }
        ).setWebhookShouldThrow?.(false);
      }
    });
  });
  it('creates direct charges on the restaurant account with the platform fee and a stable key', async () => {
    await createPaymentIntent({
      amount: 10000,
      currency: 'eur',
      metadata: { checkoutId: 'checkout' },
      stripeAccountId: 'acct_restaurant',
      applicationFeeAmount: 500,
      idempotencyKey: 'checkout-key',
    });
    expect(sdk.create).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 10000, application_fee_amount: 500 }),
      { stripeAccount: 'acct_restaurant', idempotencyKey: 'checkout-key' },
    );
  });

  it('retrieves payment state inside the correct connected account', async () => {
    await retrievePaymentIntent('pi_test', 'acct_restaurant');
    expect(sdk.retrieve).toHaveBeenCalledWith(
      'pi_test',
      { expand: ['latest_charge'] },
      { stripeAccount: 'acct_restaurant' },
    );
  });

  it('refunds the restaurant charge and its application fee with the same retry key', async () => {
    await createRefund({
      paymentIntentId: 'pi_test',
      amount: 2500,
      stripeAccountId: 'acct_restaurant',
      idempotencyKey: 'refund-key',
    });
    expect(sdk.refundCreate).toHaveBeenCalledWith(
      { payment_intent: 'pi_test', amount: 2500, refund_application_fee: true },
      { stripeAccount: 'acct_restaurant', idempotencyKey: 'refund-key' },
    );
  });
  it('does not request an application fee refund when the restaurant charge had no fee', async () => {
    sdk.retrieve.mockResolvedValueOnce({ application_fee_amount: null });
    await createRefund({
      paymentIntentId: 'pi_zero_fee',
      amount: 2500,
      stripeAccountId: 'acct_restaurant',
      idempotencyKey: 'refund-no-fee',
    });
    expect(sdk.refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({ refund_application_fee: false }),
      { stripeAccount: 'acct_restaurant', idempotencyKey: 'refund-no-fee' },
    );
  });
});
