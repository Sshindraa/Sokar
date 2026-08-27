import Stripe from 'stripe';
import type { Plan } from '@prisma/client';
import { db } from '../../shared/db/client';
import { logger } from '../../shared/logger/pino';

export const PUBLIC_BILLING_PLANS = ['essential', 'pro', 'multi-site'] as const;
export type PublicBillingPlan = (typeof PUBLIC_BILLING_PLANS)[number];

export const BILLING_INTERVALS = ['monthly', 'annual'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

const PLAN_TO_DATABASE: Record<PublicBillingPlan, Plan> = {
  // STARTER is the historical database value used for the Essential offer.
  essential: 'STARTER',
  pro: 'PRO',
  'multi-site': 'PREMIUM',
};

const PRICE_ENV_BY_PLAN: Record<
  PublicBillingPlan,
  Record<BillingInterval, keyof NodeJS.ProcessEnv>
> = {
  essential: {
    monthly: 'STRIPE_PRICE_ESSENTIAL_MONTHLY',
    annual: 'STRIPE_PRICE_ESSENTIAL_ANNUAL',
  },
  pro: {
    monthly: 'STRIPE_PRICE_PRO_MONTHLY',
    annual: 'STRIPE_PRICE_PRO_ANNUAL',
  },
  'multi-site': {
    monthly: 'STRIPE_PRICE_MULTI_SITE_MONTHLY',
    annual: 'STRIPE_PRICE_MULTI_SITE_ANNUAL',
  },
};

const MULTI_SITE_ADDON_PRICE_ENV_BY_INTERVAL: Record<BillingInterval, keyof NodeJS.ProcessEnv> = {
  monthly: 'STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY',
  annual: 'STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL',
};

const MIN_MULTI_SITE_COUNT = 2;
const MAX_MULTI_SITE_COUNT = 100;

export class BillingNotConfiguredError extends Error {
  readonly code = 'BILLING_NOT_CONFIGURED';

  constructor() {
    super('Stripe Billing is not configured');
    this.name = 'BillingNotConfiguredError';
  }
}

export class BillingRestaurantNotFoundError extends Error {
  readonly code = 'RESTAURANT_NOT_FOUND';

  constructor() {
    super('Restaurant not found');
    this.name = 'BillingRestaurantNotFoundError';
  }
}

export class BillingCheckoutError extends Error {
  readonly code = 'BILLING_CHECKOUT_FAILED';

  constructor() {
    super('Unable to create billing checkout session');
    this.name = 'BillingCheckoutError';
  }
}

export class BillingAlreadySubscribedError extends Error {
  readonly code = 'BILLING_ALREADY_SUBSCRIBED';

  constructor() {
    super('Restaurant already has an active subscription');
    this.name = 'BillingAlreadySubscribedError';
  }
}

export class BillingInvalidSiteCountError extends Error {
  readonly code = 'INVALID_SITE_COUNT';

  constructor() {
    super('Multi-site requires between 2 and 100 establishments');
    this.name = 'BillingInvalidSiteCountError';
  }
}

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY?.trim();
    if (!key) throw new BillingNotConfiguredError();
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function isPublicBillingPlan(value: string): value is PublicBillingPlan {
  return (PUBLIC_BILLING_PLANS as readonly string[]).includes(value);
}

function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value);
}

export function resolvePriceId(plan: PublicBillingPlan, billing: BillingInterval): string | null {
  const envName = PRICE_ENV_BY_PLAN[plan][billing];
  const value = process.env[envName]?.trim();
  return value?.startsWith('price_') ? value : null;
}

export function resolveMultiSiteAddonPriceId(billing: BillingInterval): string | null {
  const envName = MULTI_SITE_ADDON_PRICE_ENV_BY_INTERVAL[billing];
  const value = process.env[envName]?.trim();
  return value?.startsWith('price_') ? value : null;
}

function normalizeSiteCount(plan: PublicBillingPlan, siteCount?: number): number {
  if (plan !== 'multi-site') return 1;
  const normalized = siteCount ?? MIN_MULTI_SITE_COUNT;
  if (
    !Number.isInteger(normalized) ||
    normalized < MIN_MULTI_SITE_COUNT ||
    normalized > MAX_MULTI_SITE_COUNT
  ) {
    throw new BillingInvalidSiteCountError();
  }
  return normalized;
}

export function getPublicPlanFromPriceId(priceId: string): PublicBillingPlan | null {
  for (const plan of PUBLIC_BILLING_PLANS) {
    for (const interval of BILLING_INTERVALS) {
      if (resolvePriceId(plan, interval) === priceId) return plan;
    }
  }
  return null;
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function dashboardUrl(path: string): string {
  const base = (process.env.DASHBOARD_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

export async function createCheckoutSession(input: {
  restaurantId: string;
  plan: PublicBillingPlan;
  billing: BillingInterval;
  siteCount?: number;
}): Promise<{ id: string; url: string }> {
  const priceId = resolvePriceId(input.plan, input.billing);
  const siteCount = normalizeSiteCount(input.plan, input.siteCount);
  const addonPriceId =
    input.plan === 'multi-site' ? resolveMultiSiteAddonPriceId(input.billing) : null;
  if (!priceId || (input.plan === 'multi-site' && !addonPriceId)) {
    throw new BillingNotConfiguredError();
  }

  const restaurant = await db.restaurant.findUnique({ where: { id: input.restaurantId } });
  if (!restaurant) throw new BillingRestaurantNotFoundError();

  const billing = await db.restaurantBilling.findUnique({ where: { restaurantId: restaurant.id } });
  if (
    billing?.stripeSubscriptionId &&
    ['active', 'trialing', 'past_due'].includes(billing.subscriptionStatus ?? '')
  ) {
    throw new BillingAlreadySubscribedError();
  }
  let customerId = billing?.stripeCustomerId ?? null;
  const stripe = getStripe();

  if (!customerId) {
    const customer = await stripe.customers.create({
      name: restaurant.name,
      email: normalizeEmail(restaurant.managerEmail),
      metadata: { restaurantId: restaurant.id },
    });
    customerId = customer.id;
    if (billing) {
      await db.restaurantBilling.update({
        where: { restaurantId: restaurant.id },
        data: { stripeCustomerId: customerId },
      });
    } else {
      await db.restaurantBilling.create({
        data: { restaurantId: restaurant.id, stripeCustomerId: customerId },
      });
    }
  }

  try {
    const lineItems = [
      { price: priceId, quantity: 1 },
      ...(addonPriceId ? [{ price: addonPriceId, quantity: siteCount - 1 }] : []),
    ];
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: restaurant.id,
      line_items: lineItems,
      metadata: {
        restaurantId: restaurant.id,
        plan: input.plan,
        billing: input.billing,
        siteCount: String(siteCount),
      },
      subscription_data: {
        metadata: {
          restaurantId: restaurant.id,
          plan: input.plan,
          billing: input.billing,
          siteCount: String(siteCount),
        },
      },
      success_url: dashboardUrl(
        '/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}',
      ),
      cancel_url: dashboardUrl('/pricing?billing=cancelled'),
    });

    if (!session.url) throw new BillingCheckoutError();
    return { id: session.id, url: session.url };
  } catch (error) {
    if (error instanceof BillingCheckoutError) throw error;
    logger.error(
      { err: error instanceof Error ? error.message : String(error), restaurantId: restaurant.id },
      '[billing] Stripe Checkout session creation failed',
    );
    throw new BillingCheckoutError();
  }
}

type SubscriptionObject = Stripe.Subscription & {
  metadata: Record<string, string>;
};

function subscriptionUpdateData(
  subscription: SubscriptionObject,
  plan: PublicBillingPlan | null,
  deleted: boolean,
) {
  const priceId = subscription.items.data[0]?.price?.id;
  return {
    stripeCustomerId: stripeObjectId(subscription.customer),
    stripeSubscriptionId: subscription.id,
    subscriptionStatus: deleted ? 'canceled' : subscription.status,
    subscriptionPriceId: priceId ?? undefined,
    subscriptionCurrentPeriodEnd: subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000)
      : null,
    subscriptionCancelAtPeriodEnd: deleted ? false : subscription.cancel_at_period_end,
    ...(plan ? { plan: deleted ? 'STARTER' : PLAN_TO_DATABASE[plan] } : {}),
  };
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<boolean> {
  if (session.mode !== 'subscription') return false;
  const metadata = session.metadata ?? {};
  const restaurantId = metadata.restaurantId ?? session.client_reference_id ?? undefined;
  const plan = metadata.plan && isPublicBillingPlan(metadata.plan) ? metadata.plan : null;
  if (!restaurantId || !plan) return false;

  const subscriptionId = stripeObjectId(session.subscription);
  const customerId = stripeObjectId(session.customer);
  await db.restaurant.update({
    where: { id: restaurantId },
    data: { plan: PLAN_TO_DATABASE[plan] },
  });
  await db.restaurantBilling.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: 'active',
      subscriptionPriceId: resolvePriceId(
        plan,
        metadata.billing && isBillingInterval(metadata.billing) ? metadata.billing : 'monthly',
      ),
    },
    update: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
      subscriptionStatus: 'active',
      subscriptionPriceId: resolvePriceId(
        plan,
        metadata.billing && isBillingInterval(metadata.billing) ? metadata.billing : 'monthly',
      ),
    },
  });
  return true;
}

async function handleSubscriptionEvent(
  eventType:
    | 'customer.subscription.created'
    | 'customer.subscription.updated'
    | 'customer.subscription.deleted',
  subscription: SubscriptionObject,
): Promise<boolean> {
  const metadata = subscription.metadata ?? {};
  let restaurantId: string | undefined = metadata.restaurantId;
  if (!restaurantId) {
    const existing = await db.restaurantBilling.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    restaurantId = existing?.restaurantId;
  }
  if (!restaurantId) return false;

  const priceId = subscription.items.data[0]?.price?.id;
  const planFromMetadata =
    metadata.plan && isPublicBillingPlan(metadata.plan) ? metadata.plan : null;
  const plan = planFromMetadata ?? (priceId ? getPublicPlanFromPriceId(priceId) : null);
  const deleted = eventType === 'customer.subscription.deleted';
  const billingData = subscriptionUpdateData(subscription, plan, deleted);
  if (plan && deleted) {
    await db.restaurant.update({ where: { id: restaurantId }, data: { plan: 'STARTER' } });
  } else if (plan && eventType !== 'customer.subscription.deleted') {
    await db.restaurant.update({
      where: { id: restaurantId },
      data: { plan: PLAN_TO_DATABASE[plan] },
    });
  }
  await db.restaurantBilling.upsert({
    where: { restaurantId },
    create: { restaurantId, ...billingData },
    update: billingData,
  });
  return true;
}

/**
 * Applies only subscription events. Gift-card events remain handled by the
 * existing payment service. Returning false lets the webhook route log an
 * unknown/non-subscription event without mutating tenant billing state.
 */
export async function handleBillingWebhook(event: Stripe.Event): Promise<boolean> {
  if (event.type === 'checkout.session.completed') {
    return handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
  }

  if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    return handleSubscriptionEvent(event.type, event.data.object as unknown as SubscriptionObject);
  }

  return false;
}
