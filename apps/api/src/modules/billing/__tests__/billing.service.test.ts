import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { BillingWebhookInProgressError, handleBillingWebhook } from '../billing.service';

describe('billing.service - Stripe subscription webhooks', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  });

  it('active une formule depuis checkout.session.completed', async () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly_test';
    vi.mocked(db.stripeWebhookEvent.findUnique).mockResolvedValue(null);

    const handled = await handleBillingWebhook({
      type: 'checkout.session.completed',
      id: 'evt_checkout_1',
      created: 100,
      data: {
        object: {
          mode: 'subscription',
          id: 'cs_test',
          client_reference_id: 'test-rest-1',
          customer: 'cus_test',
          subscription: 'sub_test',
          metadata: { restaurantId: 'test-rest-1', plan: 'pro', billing: 'monthly' },
        },
      },
    } as never);

    expect(handled).toBe(true);
    expect(db.restaurant.update).toHaveBeenCalledWith({
      where: { id: 'test-rest-1' },
      data: { plan: 'PRO' },
    });
    expect(db.restaurantBilling.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'test-rest-1' },
        create: expect.objectContaining({
          stripeCustomerId: 'cus_test',
          stripeSubscriptionId: 'sub_test',
          subscriptionStatus: 'active',
          subscriptionPriceId: 'price_pro_monthly_test',
        }),
      }),
    );
  });

  it('synchronise le statut et rétrograde au plan Essential après suppression', async () => {
    vi.mocked(db.stripeWebhookEvent.findUnique).mockResolvedValue(null);
    const subscription = {
      id: 'sub_test',
      customer: 'cus_test',
      metadata: { restaurantId: 'test-rest-1', plan: 'pro' },
      status: 'canceled',
      cancel_at_period_end: false,
      current_period_end: 1_800_000_000,
      items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
    };

    const handled = await handleBillingWebhook({
      type: 'customer.subscription.deleted',
      id: 'evt_subscription_deleted_1',
      created: 200,
      data: { object: subscription },
    } as never);

    expect(handled).toBe(true);
    expect(db.restaurant.update).toHaveBeenCalledWith({
      where: { id: 'test-rest-1' },
      data: { plan: 'STARTER' },
    });
    expect(db.restaurantBilling.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          stripeSubscriptionId: 'sub_test',
          subscriptionStatus: 'canceled',
          subscriptionCancelAtPeriodEnd: false,
        }),
      }),
    );
  });

  it('ignore un événement Stripe déjà traité sans remuter le restaurant', async () => {
    vi.mocked(db.stripeWebhookEvent.findUnique).mockResolvedValue({
      eventId: 'evt_duplicate',
      status: 'processed',
    } as unknown as Awaited<ReturnType<typeof db.stripeWebhookEvent.findUnique>>);

    const handled = await handleBillingWebhook({
      type: 'customer.subscription.updated',
      id: 'evt_duplicate',
      created: 300,
      data: { object: {} },
    } as never);

    expect(handled).toBe(true);
    expect(db.restaurant.update).not.toHaveBeenCalled();
    expect(db.restaurantBilling.upsert).not.toHaveBeenCalled();
  });

  it('demande à Stripe de réessayer si un autre worker traite encore l’événement', async () => {
    vi.mocked(db.stripeWebhookEvent.findUnique).mockResolvedValue({
      eventId: 'evt_in_flight',
      status: 'processing',
      lastAttemptAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof db.stripeWebhookEvent.findUnique>>);

    await expect(
      handleBillingWebhook({
        type: 'customer.subscription.updated',
        id: 'evt_in_flight',
        created: 300,
        data: { object: {} },
      } as never),
    ).rejects.toBeInstanceOf(BillingWebhookInProgressError);
    expect(db.restaurant.update).not.toHaveBeenCalled();
    expect(db.stripeWebhookEvent.update).not.toHaveBeenCalled();
  });

  it('ignore un événement plus ancien que le dernier checkpoint de facturation', async () => {
    vi.mocked(db.stripeWebhookEvent.findUnique).mockResolvedValue(null);
    vi.mocked(db.restaurantBilling.findUnique).mockResolvedValue({
      restaurantId: 'test-rest-1',
      lastStripeEventCreated: 500,
      lastStripeEventId: 'evt_newer',
    } as unknown as Awaited<ReturnType<typeof db.restaurantBilling.findUnique>>);

    const handled = await handleBillingWebhook({
      type: 'customer.subscription.updated',
      id: 'evt_older',
      created: 400,
      data: {
        object: {
          id: 'sub_test',
          customer: 'cus_test',
          metadata: { restaurantId: 'test-rest-1', plan: 'pro' },
          status: 'active',
          cancel_at_period_end: false,
          current_period_end: 1_800_000_000,
          items: { data: [{ price: { id: 'price_pro_monthly_test' } }] },
        },
      },
    } as never);

    expect(handled).toBe(true);
    expect(db.restaurant.update).not.toHaveBeenCalled();
    expect(db.restaurantBilling.upsert).not.toHaveBeenCalled();
  });
});
