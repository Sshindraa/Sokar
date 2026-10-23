/** Opt-in contract test against Stripe sandbox. No real DB or live key is accepted. */
import fs from 'node:fs';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import Stripe from 'stripe';
import { db } from '../../../shared/db/client';
import { createBillingPortalSession, getBillingDetails } from '../billing.service';

vi.unmock('stripe');
const fixturePath = process.env.SOKAR_BILLING_SANDBOX_FIXTURE;
let stripe: Stripe;
let customer: Stripe.Customer | undefined;
let subscription: Stripe.Subscription | undefined;
let fixture: {
  key: string;
  price: string;
  fixture: { customerId: string; subscriptionId: string };
};

beforeAll(async () => {
  if (!fixturePath) return;
  fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  if (!fixture.key.startsWith('sk_test_')) throw new Error('Sandbox key required');
  process.env.STRIPE_SECRET_KEY = fixture.key;
  process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY = fixture.price;
  stripe = new Stripe(fixture.key);
  const account = await stripe.accounts.retrieve();
  if (account.id !== 'acct_1TptMCHCZZuqZF0h') throw new Error('Unexpected sandbox account');
}, 20000);

afterAll(async () => {
  if (subscription) await stripe.subscriptions.cancel(subscription.id);
  if (customer) await stripe.customers.del(customer.id);
}, 20000);

it.skipIf(!fixturePath)(
  'reads real invoices and verifies all portal flows for a disposable trial',
  async () => {
    const scope = { restaurantId: 'sandbox-contract-site' };
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: scope.restaurantId,
      accountId: null,
    } as never);
    vi.mocked(db.restaurantBilling.findUnique).mockResolvedValue({
      stripeCustomerId: fixture.fixture.customerId,
      stripeSubscriptionId: fixture.fixture.subscriptionId,
    } as never);
    const previous = await getBillingDetails(scope);
    expect(
      previous.invoices.some((invoice) => invoice.status === 'paid' && invoice.total === 19900),
    ).toBe(true);
    expect(previous.paymentMethod?.last4).toBe('4242');

    customer = await stripe.customers.create({
      metadata: { purpose: 'sokar-billing-contract-test' },
    });
    subscription = await stripe.subscriptions.create({
      customer: customer.id,
      items: [{ price: fixture.price }],
      trial_period_days: 14,
      trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
      metadata: { purpose: 'sokar-billing-contract-test' },
    });
    expect(subscription.livemode).toBe(false);
    vi.mocked(db.restaurantBilling.findUnique).mockResolvedValue({
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
    } as never);
    const details = await getBillingDetails(scope);
    expect(details.subscription?.status).toBe('trialing');
    expect(details.subscription?.plan).toBe('essential');
    expect(details.subscription?.recurringAmount).toBe(19900);
    expect(details.hasPaymentMethod).toBe(false);
    for (const intent of [
      'manage',
      'payment_method',
      'subscription_update',
      'subscription_cancel',
    ] as const) {
      const session = await createBillingPortalSession({ ...scope, intent, returnTo: 'billing' });
      // Never log the short-lived portal session URL.
      expect(session.url.startsWith('https://billing.stripe.com/')).toBe(true);
    }
  },
  60000,
);
