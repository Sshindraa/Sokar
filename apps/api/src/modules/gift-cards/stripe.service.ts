/**
 * Stripe service — Payment Intents + webhook pour les cartes cadeaux.
 *
 * En dev, utiliser les clés de test Stripe (sk_test_*).
 * Le webhook nécessite une URL publique (ngrok ou domaine de prod).
 */
import Stripe from 'stripe';
import { logger } from '../../shared/logger/pino';

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is required');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

export type CreatePaymentIntentInput = {
  amount: number; // en centimes
  currency: string;
  metadata: Record<string, string>;
};

/**
 * Crée un PaymentIntent Stripe pour un paiement carte cadeau.
 * Retourne le client_secret à utiliser côté client avec Stripe Elements.
 */
export async function createPaymentIntent(input: CreatePaymentIntentInput): Promise<{
  id: string;
  clientSecret: string;
}> {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.create({
    amount: input.amount,
    currency: input.currency,
    metadata: input.metadata,
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
  });
  return {
    id: intent.id,
    clientSecret: intent.client_secret!,
  };
}

/**
 * Récupère le statut d'un PaymentIntent.
 */
export async function retrievePaymentIntent(
  paymentIntentId: string,
): Promise<{ id: string; status: string }> {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
  return { id: intent.id, status: intent.status };
}

export type CreateRefundInput = {
  paymentIntentId: string;
  amount?: number; // montant en centimes (optionnel = remboursement total)
};

/**
 * Crée un remboursement Stripe sur un PaymentIntent.
 */
export async function createRefund(
  input: CreateRefundInput,
): Promise<{ id: string; amount: number; status: string }> {
  const stripe = getStripe();
  const refund = await stripe.refunds.create({
    payment_intent: input.paymentIntentId,
    amount: input.amount,
  });
  return { id: refund.id, amount: refund.amount, status: refund.status ?? 'pending' };
}

/**
 * Construit et vérifie un event Stripe depuis le webhook (signature verification).
 * Supporte une liste de secrets séparés par des virgules pour la rotation.
 */
export async function constructWebhookEvent(
  payload: string,
  signature: string,
): Promise<Stripe.Event> {
  const rawSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!rawSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required');
  }

  const secrets = rawSecret
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (secrets.length === 0) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required');
  }

  const stripe = getStripe();
  let lastError: unknown;

  for (const secret of secrets) {
    try {
      return stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (err: unknown) {
      lastError = err;
    }
  }

  throw lastError ?? new Error('STRIPE_WEBHOOK_SECRET is required');
}

export { logger };
