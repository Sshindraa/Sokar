import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';

vi.unmock('@prisma/client');
vi.unmock('stripe');
vi.mock('../../../shared/db/client', async () => {
  const { PrismaClient } = await vi.importActual<typeof import('@prisma/client')>('@prisma/client');
  return {
    db: new PrismaClient({
      datasources: {
        db: {
          url:
            process.env.BILLING_AUDIT_TEST_DATABASE_URL ??
            'postgresql://localhost/sokar_billing_audit_unused',
        },
      },
    }),
  };
});

import { db } from '../../../shared/db/client';
import {
  buildCheckoutIdempotencyKey,
  createCheckoutSession,
  handleBillingWebhook,
  startTrial,
} from '../billing.service';
import { applyReservationPaymentProviderEvent } from '../../reservation-payments/reservation-payment.service';

const dbUrl = process.env.BILLING_AUDIT_TEST_DATABASE_URL;
const sandboxKey = process.env.BILLING_AUDIT_STRIPE_KEY;
if (dbUrl) {
  const target = new URL(dbUrl);
  if (
    !['localhost', '127.0.0.1'].includes(target.hostname) ||
    !/^\/sokar_(billing|reservation)_audit_[a-z0-9_]+$/.test(target.pathname)
  ) {
    throw new Error('Billing audit tests require a dedicated local database');
  }
}
if (sandboxKey && !sandboxKey.startsWith('sk_test_')) throw new Error('Stripe test key required');

const accounts: string[] = [];
const restaurants: string[] = [];
const eventIds: string[] = [];
const customers: string[] = [];
let stripe: Stripe;
let productId: string | undefined;
let priceIds: string[] = [];

async function createAccount() {
  const tag = randomUUID();
  const account = await db.restaurantAccount.create({
    data: { clerkOrganizationId: `audit-${tag}`, name: 'Billing audit' },
  });
  accounts.push(account.id);
  const primary = await db.restaurant.create({
    data: {
      accountId: account.id,
      isPrimary: true,
      name: 'Audit primary',
      managerPhone: '',
      managerEmail: '',
      phoneNumber: `audit-${tag}-1`,
      openingHours: {},
    },
  });
  const secondary = await db.restaurant.create({
    data: {
      accountId: account.id,
      name: 'Audit secondary',
      managerPhone: '',
      managerEmail: '',
      phoneNumber: `audit-${tag}-2`,
      openingHours: {},
    },
  });
  restaurants.push(primary.id, secondary.id);
  return { account, primary, secondary };
}

describe.skipIf(!dbUrl)('billing concurrency — real PostgreSQL', () => {
  beforeAll(async () => {
    await db.$connect();
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_audit_pro';
    process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY = 'price_audit_essential';
    if (sandboxKey) {
      process.env.STRIPE_SECRET_KEY = sandboxKey;
      stripe = new Stripe(sandboxKey);
      const product = await stripe.products.create({ name: 'Sokar billing audit test' });
      productId = product.id;
      const pro = await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: 29900,
        recurring: { interval: 'month' },
      });
      const essential = await stripe.prices.create({
        product: product.id,
        currency: 'eur',
        unit_amount: 19900,
        recurring: { interval: 'month' },
      });
      priceIds = [pro.id, essential.id];
      process.env.STRIPE_PRICE_PRO_MONTHLY = pro.id;
      process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY = essential.id;
    }
  }, 30000);

  afterAll(async () => {
    if (stripe) {
      for (const customer of customers) {
        const sessions = await stripe.checkout.sessions.list({
          customer,
          status: 'open',
          limit: 100,
        });
        for (const session of sessions.data) await stripe.checkout.sessions.expire(session.id);
        const subscriptions = await stripe.subscriptions.list({
          customer,
          status: 'all',
          limit: 100,
        });
        for (const subscription of subscriptions.data)
          if (subscription.status !== 'canceled')
            await stripe.subscriptions.cancel(subscription.id);
        await stripe.customers.del(customer);
      }
      for (const id of priceIds) await stripe.prices.update(id, { active: false });
      if (productId) await stripe.products.update(productId, { active: false });
    }
    if (eventIds.length)
      await db.stripeWebhookEvent.deleteMany({ where: { eventId: { in: eventIds } } });
    if (restaurants.length) {
      await db.reservation.deleteMany({ where: { restaurantId: { in: restaurants } } });
      await db.reservationPaymentPolicy.deleteMany({
        where: { restaurantId: { in: restaurants } },
      });
      await db.restaurant.deleteMany({ where: { id: { in: restaurants } } });
    }
    if (accounts.length) await db.restaurantAccount.deleteMany({ where: { id: { in: accounts } } });
    await db.$disconnect();
  }, 60000);

  it('keeps the newest entitlement when two sites receive simultaneous subscription events', async () => {
    const { account, primary, secondary } = await createAccount();
    const tag = randomUUID();
    const subscription = `sub_${tag}`;
    const customer = `cus_${tag}`;
    const makeEvent = (restaurantId: string, created: number, status: string, plan: string) => {
      const id = `evt_${randomUUID()}`;
      eventIds.push(id);
      return {
        id,
        type: 'customer.subscription.updated',
        created,
        data: {
          object: {
            id: subscription,
            customer,
            status,
            cancel_at_period_end: false,
            metadata: { restaurantId, accountId: account.id, plan, siteCount: '1' },
            items: {
              data: [
                {
                  price: {
                    id:
                      plan === 'pro'
                        ? process.env.STRIPE_PRICE_PRO_MONTHLY
                        : process.env.STRIPE_PRICE_ESSENTIAL_MONTHLY,
                    recurring: { interval: 'month' },
                  },
                },
              ],
            },
          },
        },
      } as never;
    };
    await Promise.all([
      handleBillingWebhook(makeEvent(secondary.id, 200, 'active', 'pro')),
      handleBillingWebhook(makeEvent(primary.id, 100, 'trialing', 'essential')),
    ]);
    const billing = await db.restaurantBilling.findUniqueOrThrow({
      where: { restaurantId: primary.id },
    });
    const accountBilling = await db.restaurantAccountBilling.findUniqueOrThrow({
      where: { accountId: account.id },
    });
    expect(billing.subscriptionStatus).toBe('active');
    expect(billing.lastStripeEventCreated).toBe(200);
    expect(accountBilling.subscriptionStatus).toBe('active');
    expect(accountBilling.lastStripeEventCreated).toBe(200);
    expect((await db.restaurant.findUniqueOrThrow({ where: { id: secondary.id } })).plan).toBe(
      'PRO',
    );
  });

  it('keeps the latest refund when payment events run concurrently', async () => {
    const { primary } = await createAccount();
    const reservation = await db.reservation.create({
      data: {
        restaurantId: primary.id,
        reservedAt: new Date(),
        partySize: 2,
        customerName: 'Test',
      },
    });
    const policy = await db.reservationPaymentPolicy.create({
      data: {
        restaurantId: primary.id,
        version: 1,
        type: 'DEPOSIT',
        amountMode: 'FIXED',
        amount: 25,
      },
    });
    const paymentIntentId = `pi_${randomUUID()}`;
    const payment = await db.reservationPayment.create({
      data: {
        restaurantId: primary.id,
        reservationId: reservation.id,
        policyId: policy.id,
        status: 'CAPTURED',
        amount: 25,
        currency: 'EUR',
        stripePaymentIntentId: paymentIntentId,
        idempotencyKey: randomUUID(),
        policySnapshot: {},
      },
    });
    const event = (seconds: number, refundedAmount: number) => ({
      restaurantId: primary.id,
      paymentId: payment.id,
      providerEventId: `evt_${randomUUID()}`,
      eventType: 'charge.refunded',
      occurredAt: new Date(seconds * 1000),
      payloadHash: 'a'.repeat(64),
      amount: 25,
      refundedAmount,
      currency: 'EUR',
      stripePaymentIntentId: paymentIntentId,
    });
    await Promise.all([
      applyReservationPaymentProviderEvent(event(200, 25)),
      applyReservationPaymentProviderEvent(event(100, 10)),
    ]);
    expect(
      (await db.reservationPayment.findUniqueOrThrow({ where: { id: payment.id } })).status,
    ).toBe('REFUNDED');
  });

  it.skipIf(!sandboxKey)(
    'creates only one Stripe trial for concurrent choices',
    async () => {
      const { account, primary, secondary } = await createAccount();
      const results = await Promise.allSettled([
        startTrial({ restaurantId: primary.id, accountId: account.id, plan: 'pro' }),
        startTrial({ restaurantId: secondary.id, accountId: account.id, plan: 'essential' }),
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      const billing = await db.restaurantAccountBilling.findUniqueOrThrow({
        where: { accountId: account.id },
      });
      customers.push(billing.stripeCustomerId!);
      const subscriptions = await stripe.subscriptions.list({
        customer: billing.stripeCustomerId!,
        status: 'all',
      });
      expect(subscriptions.data).toHaveLength(1);
      expect(subscriptions.data[0].livemode).toBe(false);
    },
    60000,
  );

  it.skipIf(!sandboxKey)(
    'expires an open Checkout before starting a trial',
    async () => {
      const { account, primary } = await createAccount();
      const checkout = await createCheckoutSession({
        restaurantId: primary.id,
        accountId: account.id,
        plan: 'essential',
        billing: 'monthly',
      });
      const billing = await db.restaurantBilling.findUniqueOrThrow({
        where: { restaurantId: primary.id },
      });
      customers.push(billing.stripeCustomerId!);
      await startTrial({ restaurantId: primary.id, accountId: account.id, plan: 'pro' });
      expect((await stripe.checkout.sessions.retrieve(checkout.id)).status).toBe('expired');
      const subscriptions = await stripe.subscriptions.list({
        customer: billing.stripeCustomerId!,
        status: 'all',
      });
      expect(subscriptions.data).toHaveLength(1);
    },
    60000,
  );

  it.skipIf(!sandboxKey)(
    'recovers a Stripe trial created before the local projection failed',
    async () => {
      const { account, primary } = await createAccount();
      const customer = await stripe.customers.create({
        metadata: { purpose: 'sokar-billing-audit' },
      });
      customers.push(customer.id);
      const key = `sokar-trial-${customer.id}-pro-monthly-1`;
      await db.restaurantBilling.create({
        data: {
          restaurantId: primary.id,
          stripeCustomerId: customer.id,
          checkoutIdempotencyKey: key,
          checkoutPlan: 'pro',
          checkoutBillingInterval: 'monthly',
          checkoutSiteCount: 1,
          checkoutCreatedAt: new Date(),
        },
      });
      const subscription = await stripe.subscriptions.create(
        {
          customer: customer.id,
          items: [{ price: priceIds[0] }],
          trial_period_days: 14,
          trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
          payment_settings: { save_default_payment_method: 'on_subscription' },
          metadata: {
            restaurantId: primary.id,
            accountId: account.id,
            plan: 'pro',
            billing: 'monthly',
            siteCount: '1',
            trial: 'true',
            source: 'onboarding',
          },
        },
        { idempotencyKey: key },
      );
      expect(
        (await startTrial({ restaurantId: primary.id, accountId: account.id, plan: 'pro' })).status,
      ).toBe('trialing');
      expect(
        (await db.restaurantAccountBilling.findUniqueOrThrow({ where: { accountId: account.id } }))
          .stripeSubscriptionId,
      ).toBe(subscription.id);
      expect(
        (await stripe.subscriptions.list({ customer: customer.id, status: 'all' })).data,
      ).toHaveLength(1);
    },
    60000,
  );

  it.skipIf(!sandboxKey)(
    'recovers a Checkout session after its response was lost',
    async () => {
      const { account, primary } = await createAccount();
      const customer = await stripe.customers.create({
        metadata: { purpose: 'sokar-billing-audit' },
      });
      customers.push(customer.id);
      const key = buildCheckoutIdempotencyKey({
        restaurantId: primary.id,
        scopeId: account.id,
        plan: 'pro',
        billing: 'monthly',
        siteCount: 1,
      });
      await db.restaurantBilling.create({
        data: {
          restaurantId: primary.id,
          stripeCustomerId: customer.id,
          checkoutIdempotencyKey: key,
          checkoutPlan: 'pro',
          checkoutBillingInterval: 'monthly',
          checkoutSiteCount: 1,
          checkoutCreatedAt: new Date(),
        },
      });
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'subscription',
          customer: customer.id,
          line_items: [{ price: priceIds[0], quantity: 1 }],
          metadata: {
            restaurantId: primary.id,
            accountId: account.id,
            plan: 'pro',
            billing: 'monthly',
            siteCount: '1',
          },
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        },
        { idempotencyKey: key },
      );
      const result = await createCheckoutSession({
        restaurantId: primary.id,
        accountId: account.id,
        plan: 'pro',
        billing: 'monthly',
      });
      expect(result.id).toBe(session.id);
      const open = await stripe.checkout.sessions.list({ customer: customer.id, status: 'open' });
      expect(open.data).toHaveLength(1);
    },
    60000,
  );
});
