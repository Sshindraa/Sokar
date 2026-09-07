import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeApp, getApp } from '../../../test/helpers';
import { db } from '../../../shared/db/client';
import { buildCheckoutIdempotencyKey } from '../billing.service';

const originalEnv = {
  secret: process.env.STRIPE_SECRET_KEY,
  price: process.env.STRIPE_PRICE_PRO_MONTHLY,
  multiSitePrice: process.env.STRIPE_PRICE_MULTI_SITE_MONTHLY,
  multiSiteAddonPrice: process.env.STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY,
};

describe('billing.routes - POST /billing/checkout-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_unit';
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    delete process.env.STRIPE_PRICE_MULTI_SITE_MONTHLY;
    delete process.env.STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY;
  });

  afterEach(() => {
    if (originalEnv.secret === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = originalEnv.secret;
    if (originalEnv.price === undefined) delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    else process.env.STRIPE_PRICE_PRO_MONTHLY = originalEnv.price;
    if (originalEnv.multiSitePrice === undefined)
      delete process.env.STRIPE_PRICE_MULTI_SITE_MONTHLY;
    else process.env.STRIPE_PRICE_MULTI_SITE_MONTHLY = originalEnv.multiSitePrice;
    if (originalEnv.multiSiteAddonPrice === undefined)
      delete process.env.STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY;
    else process.env.STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY = originalEnv.multiSiteAddonPrice;
  });

  afterAll(async () => {
    await closeApp();
  });

  it('refuse une requête sans authentification', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      payload: { plan: 'pro', billing: 'monthly' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('valide strictement le plan et la cadence', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers: { authorization: 'Bearer test' },
      payload: { plan: 'starter', billing: 'monthly' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('retourne une erreur explicite si le prix Stripe n’est pas configuré', async () => {
    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers: { authorization: 'Bearer test' },
      payload: { plan: 'pro', billing: 'monthly' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'BILLING_NOT_CONFIGURED',
      message: 'La souscription en ligne sera bientôt disponible.',
    });
  });

  it('crée une session Checkout hébergée pour le restaurant authentifié', async () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly_test';
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Bistrot du Coin',
      managerEmail: 'manager@example.com',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    vi.mocked(db.restaurantBilling.findUnique).mockResolvedValue(null);

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers: { authorization: 'Bearer test' },
      payload: { plan: 'pro', billing: 'monthly' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: 'cs_test',
      url: 'https://checkout.stripe.test/cs_test',
    });
    expect(db.restaurantBilling.upsert).toHaveBeenCalledWith({
      where: { restaurantId: 'test-rest-1' },
      create: { restaurantId: 'test-rest-1', stripeCustomerId: 'cus_test' },
      update: { stripeCustomerId: 'cus_test' },
    });
  });

  it('réutilise la session Checkout lors d’un retry avec la même clé d’idempotence', async () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly_test';
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Bistrot du Coin',
      managerEmail: 'manager@example.com',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    vi.mocked(db.restaurantBilling.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        restaurantId: 'test-rest-1',
        stripeCustomerId: 'cus_test',
        checkoutIdempotencyKey: buildCheckoutIdempotencyKey({
          restaurantId: 'test-rest-1',
          plan: 'pro',
          billing: 'monthly',
          siteCount: 1,
          idempotencyKey: 'checkout-retry-1',
        }),
        checkoutSessionId: 'cs_test',
        checkoutSessionUrl: 'https://checkout.stripe.test/cs_test',
      } as unknown as Awaited<ReturnType<typeof db.restaurantBilling.findUnique>>);

    const checkoutCreate = (
      globalThis as unknown as {
        __sokarStripeCheckoutSessionCreate: { mock: { calls: unknown[][] } };
      }
    ).__sokarStripeCheckoutSessionCreate;

    const app = await getApp();
    const headers = {
      authorization: 'Bearer test',
      'idempotency-key': 'checkout-retry-1',
    };
    const first = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers,
      payload: { plan: 'pro', billing: 'monthly' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers,
      payload: { plan: 'pro', billing: 'monthly' },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(checkoutCreate.mock.calls).toHaveLength(1);
  });

  it('bloque une seconde souscription qui pourrait facturer deux fois', async () => {
    process.env.STRIPE_PRICE_PRO_MONTHLY = 'price_pro_monthly_test';
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Bistrot du Coin',
      managerEmail: 'manager@example.com',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    vi.mocked(db.restaurantBilling.findUnique).mockResolvedValue({
      restaurantId: 'test-rest-1',
      stripeSubscriptionId: 'sub_existing',
      subscriptionStatus: 'active',
    } as unknown as Awaited<ReturnType<typeof db.restaurantBilling.findUnique>>);

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers: { authorization: 'Bearer test' },
      payload: { plan: 'pro', billing: 'monthly' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: 'BILLING_ALREADY_SUBSCRIBED',
      message: 'Une souscription est déjà active pour ce restaurant.',
    });
  });

  it('facture la base et les établissements supplémentaires du Multi-site', async () => {
    process.env.STRIPE_PRICE_MULTI_SITE_MONTHLY = 'price_multi_site_monthly_test';
    process.env.STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY = 'price_multi_site_addon_monthly_test';
    vi.mocked(db.restaurant.findUnique).mockResolvedValue({
      id: 'test-rest-1',
      name: 'Bistrot du Coin',
      managerEmail: 'manager@example.com',
    } as unknown as Awaited<ReturnType<typeof db.restaurant.findUnique>>);
    vi.mocked(db.restaurantBilling.findUnique).mockResolvedValue(null);

    const app = await getApp();
    const response = await app.inject({
      method: 'POST',
      url: '/billing/checkout-session',
      headers: { authorization: 'Bearer test' },
      payload: { plan: 'multi-site', billing: 'monthly', siteCount: 3 },
    });

    expect(response.statusCode).toBe(200);
    const checkoutCreate = (
      globalThis as unknown as {
        __sokarStripeCheckoutSessionCreate: { mock: { calls: unknown[][] } };
      }
    ).__sokarStripeCheckoutSessionCreate;
    expect(checkoutCreate.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({
        line_items: [
          { price: 'price_multi_site_monthly_test', quantity: 1 },
          { price: 'price_multi_site_addon_monthly_test', quantity: 2 },
        ],
        metadata: expect.objectContaining({ siteCount: '3' }),
      }),
    );
  });
});
