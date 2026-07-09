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

import {
  createPaymentIntent,
  retrievePaymentIntent,
  constructWebhookEvent,
} from '../stripe.service';

describe('stripe.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
    });
  });

  describe('constructWebhookEvent', () => {
    it('construit et vérifie un event Stripe depuis le webhook', async () => {
      const event = await constructWebhookEvent('raw-payload', 't=signature');

      expect(event.type).toBe('payment_intent.succeeded');
    });

    it('retourne erreur si STRIPE_WEBHOOK_SECRET est manquant', async () => {
      const previous = process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      try {
        await expect(constructWebhookEvent('raw-payload', 't=signature')).rejects.toThrow(
          'STRIPE_WEBHOOK_SECRET is required',
        );
      } finally {
        process.env.STRIPE_WEBHOOK_SECRET = previous;
      }
    });
  });
});
