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
    // R1-2 : bornes explicites plutôt que les défauts du SDK. `timeout` évite
    // qu'un paiement reste en vol, `maxNetworkRetries` rejoue uniquement les
    // erreurs réseau (Stripe ne rejoue jamais un 4xx).
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      timeout: 10_000,
      maxNetworkRetries: 2,
    });
  }
  return _stripe;
}

export type CreatePaymentIntentInput = {
  amount: number; // en centimes
  currency: string;
  metadata: Record<string, string>;
  idempotencyKey?: string;
  stripeAccountId?: string;
  applicationFeeAmount?: number;
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
  const intent = await stripe.paymentIntents.create(
    {
      amount: input.amount,
      currency: input.currency,
      metadata: input.metadata,
      ...(input.applicationFeeAmount !== undefined
        ? { application_fee_amount: input.applicationFeeAmount }
        : {}),
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    },
    {
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.stripeAccountId ? { stripeAccount: input.stripeAccountId } : {}),
    },
  );
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
  stripeAccountId?: string,
): Promise<{
  id: string;
  status: string;
  amount: number;
  amountReceived: number;
  currency: string;
  metadata: Record<string, string>;
  refundedAmount?: number;
  disputed?: boolean;
  pendingRefund?: boolean;
  clientSecret?: string | null;
}> {
  const stripe = getStripe();
  const intent = await stripe.paymentIntents.retrieve(
    paymentIntentId,
    { expand: ['latest_charge'] },
    stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
  );
  const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
  const refunds = charge
    ? await stripe.refunds.list(
        { payment_intent: intent.id, limit: 100 },
        stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
      )
    : null;
  return {
    id: intent.id,
    status: intent.status,
    amount: intent.amount,
    amountReceived: intent.amount_received,
    currency: intent.currency,
    metadata: intent.metadata,
    refundedAmount: charge?.amount_refunded ?? 0,
    disputed: charge?.disputed ?? false,
    pendingRefund: Boolean(
      refunds?.has_more ||
      refunds?.data.some((refund) =>
        ['pending', 'requires_action'].includes(refund.status ?? 'pending'),
      ),
    ),
    clientSecret: intent.client_secret,
  };
}

export type CreateRefundInput = {
  paymentIntentId: string;
  amount?: number; // montant en centimes (optionnel = remboursement total)
  idempotencyKey?: string;
  stripeAccountId?: string;
};

/**
 * Crée un remboursement Stripe sur un PaymentIntent.
 */
export async function createRefund(
  input: CreateRefundInput,
): Promise<{ id: string; amount: number; status: string }> {
  const stripe = getStripe();
  const payment = input.stripeAccountId
    ? await stripe.paymentIntents.retrieve(
        input.paymentIntentId,
        {},
        { stripeAccount: input.stripeAccountId },
      )
    : null;
  const refund = await stripe.refunds.create(
    {
      payment_intent: input.paymentIntentId,
      amount: input.amount,
      refund_application_fee: Boolean(
        input.stripeAccountId && (payment?.application_fee_amount ?? 0) > 0,
      ),
    },
    {
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
      ...(input.stripeAccountId ? { stripeAccount: input.stripeAccountId } : {}),
    },
  );
  return { id: refund.id, amount: refund.amount, status: refund.status ?? 'pending' };
}

export async function retrieveRefund(refundId: string, stripeAccountId?: string) {
  const refund = await getStripe().refunds.retrieve(
    refundId,
    stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
  );
  return { id: refund.id, amount: refund.amount, status: refund.status ?? 'pending' };
}

export async function retrieveConnectedAccount(accountId: string) {
  const account = await getStripe().accounts.retrieve(accountId);
  return {
    id: account.id,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    detailsSubmitted: account.details_submitted,
  };
}

// Pin Accounts v2 only: billing and payment APIs retain the SDK's existing version.
const CONNECT_ACCOUNTS_API_VERSION = '2026-08-26.dahlia';

export async function createConnectedAccount(restaurantId: string, _email: string) {
  // The pinned SDK supports raw v2 JSON requests but predates typed Accounts v2.
  // Account IDs remain interoperable with v1 Account Links and PaymentIntents.
  // French personal data must be tokenized if prefilled; hosted onboarding collects it directly.
  const account = await getStripe().rawRequest(
    'POST',
    '/v2/core/accounts',
    {
      identity: { country: 'FR' },
      dashboard: 'full',
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: {
        currency: 'eur',
        locales: ['fr-FR'],
        responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' },
      },
      metadata: { restaurantId, source: 'sokar_gift_cards' },
    },
    {
      apiVersion: CONNECT_ACCOUNTS_API_VERSION,
      idempotencyKey: `gift-card-connect-v2:${restaurantId}:hosted`,
    },
  );
  if (
    !account ||
    typeof account !== 'object' ||
    !('id' in account) ||
    typeof account.id !== 'string' ||
    !/^acct_[A-Za-z0-9]+$/.test(account.id)
  ) {
    throw new Error('Stripe n’a pas retourné de compte connecté valide.');
  }
  return account.id;
}

export async function retrieveChargePaymentIntent(chargeId: string, stripeAccountId?: string) {
  const charge = await getStripe().charges.retrieve(
    chargeId,
    stripeAccountId ? { stripeAccount: stripeAccountId } : undefined,
  );
  return typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id;
}

export async function createConnectedAccountLink(accountId: string) {
  const origin = process.env.DASHBOARD_URL;
  if (!origin || !/^https:\/\//.test(origin)) throw new Error('DASHBOARD_URL HTTPS est requis');
  const base = new URL('/dashboard/gift-cards', origin).toString();
  return getStripe().accountLinks.create({
    account: accountId,
    type: 'account_onboarding',
    refresh_url: `${base}?stripeConnect=refresh`,
    return_url: `${base}?stripeConnect=return`,
  });
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
