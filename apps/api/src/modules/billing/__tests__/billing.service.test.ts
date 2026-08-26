import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../../shared/db/client';
import { handleBillingWebhook } from '../billing.service';

describe('billing.service - Stripe subscription webhooks', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
  });

  it('active une formule depuis checkout.session.completed', async () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly_test';

    const handled = await handleBillingWebhook({
      type: 'checkout.session.completed',
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
});
