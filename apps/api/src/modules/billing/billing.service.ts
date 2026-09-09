import { createHash } from 'node:crypto';
import Stripe from 'stripe';
import { Prisma, type Plan } from '@prisma/client';
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
const CHECKOUT_IDEMPOTENCY_BUCKET_MS = 24 * 60 * 60 * 1000;
const STRIPE_EVENT_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

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

export class BillingCustomerNotFoundError extends Error {
  readonly code = 'BILLING_CUSTOMER_NOT_FOUND';

  constructor() {
    super('No Stripe customer is associated with this account');
    this.name = 'BillingCustomerNotFoundError';
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

function getBillingIntervalFromPriceId(priceId: string): BillingInterval | null {
  for (const plan of PUBLIC_BILLING_PLANS) {
    for (const interval of BILLING_INTERVALS) {
      if (resolvePriceId(plan, interval) === priceId) return interval;
    }
  }
  return null;
}

function getPublicPlanFromDatabasePlan(plan: Plan | null | undefined): PublicBillingPlan | null {
  if (plan === 'PRO') return 'pro';
  if (plan === 'PREMIUM') return 'multi-site';
  if (plan === 'STARTER') return 'essential';
  return null;
}

export interface BillingStatus {
  /** Public offer name; Stripe identifiers are intentionally never returned. */
  plan: PublicBillingPlan | null;
  subscriptionStatus: string | null;
  billingInterval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  entitledSiteCount: number;
  accountScoped: boolean;
}

type BillingStatusProjection = {
  subscriptionStatus?: string | null;
  subscriptionPriceId?: string | null;
  subscriptionCurrentPeriodEnd?: Date | null;
  subscriptionCancelAtPeriodEnd?: boolean | null;
  entitledSiteCount?: number | null;
};

/**
 * Returns the billing projection visible to an authenticated restaurant.
 * Account-scoped billing is preferred for multi-site accounts; legacy
 * single-site rows remain supported during the additive migration.
 */
export async function getBillingStatus(input: {
  restaurantId: string;
  accountId?: string;
}): Promise<BillingStatus> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: { plan: true, accountId: true },
  });
  if (!restaurant) throw new BillingRestaurantNotFoundError();

  const accountId = restaurant.accountId ?? input.accountId;
  const accountBilling = accountId
    ? ((await db.restaurantAccountBilling.findUnique({
        where: { accountId },
      })) as BillingStatusProjection | null)
    : null;

  let billingAnchorId = input.restaurantId;
  if (accountId) {
    const primary = await db.restaurant.findFirst({
      where: { accountId, isPrimary: true, siteStatus: { not: 'ARCHIVED' } },
      select: { id: true },
    });
    billingAnchorId = primary?.id ?? input.restaurantId;
  }

  const siteBilling = (await db.restaurantBilling.findUnique({
    where: { restaurantId: billingAnchorId },
  })) as BillingStatusProjection | null;
  const projection = accountBilling ?? siteBilling;
  const priceId = projection?.subscriptionPriceId ?? null;
  const plan =
    (priceId ? getPublicPlanFromPriceId(priceId) : null) ??
    getPublicPlanFromDatabasePlan(restaurant.plan);
  const periodEnd = projection?.subscriptionCurrentPeriodEnd;

  return {
    plan,
    subscriptionStatus: projection?.subscriptionStatus ?? null,
    billingInterval: priceId ? getBillingIntervalFromPriceId(priceId) : null,
    currentPeriodEnd: periodEnd instanceof Date ? periodEnd.toISOString() : null,
    cancelAtPeriodEnd: projection?.subscriptionCancelAtPeriodEnd === true,
    entitledSiteCount:
      typeof projection?.entitledSiteCount === 'number' && projection.entitledSiteCount > 0
        ? projection.entitledSiteCount
        : 1,
    accountScoped: Boolean(accountId && accountBilling),
  };
}

function stripeObjectId(value: string | { id: string } | null | undefined): string | null {
  return typeof value === 'string' ? value : (value?.id ?? null);
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function normalizeIdempotencyKey(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

/**
 * Stripe accepts an idempotency key for Checkout requests. We hash the
 * restaurant and commercial choice so a retry cannot collide with another
 * tenant or another plan. Without a client key, the 24-hour bucket still
 * absorbs double-clicks and network retries during the purchase window.
 */
export function buildCheckoutIdempotencyKey(input: {
  restaurantId: string;
  /** Account scope keeps two sites from creating two subscriptions. */
  scopeId?: string;
  plan: PublicBillingPlan;
  billing: BillingInterval;
  siteCount: number;
  idempotencyKey?: string;
  now?: Date;
}): string {
  const bucket = Math.floor((input.now?.getTime() ?? Date.now()) / CHECKOUT_IDEMPOTENCY_BUCKET_MS);
  const source = [
    input.scopeId ?? input.restaurantId,
    input.plan,
    input.billing,
    input.siteCount,
    normalizeIdempotencyKey(input.idempotencyKey) ?? `auto:${bucket}`,
  ].join('|');
  return `sokar-checkout-${createHash('sha256').update(source).digest('hex').slice(0, 48)}`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function dashboardUrl(path: string): string {
  const base = (process.env.DASHBOARD_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${base}${path}`;
}

export async function createCheckoutSession(input: {
  restaurantId: string;
  accountId?: string;
  plan: PublicBillingPlan;
  billing: BillingInterval;
  siteCount?: number;
  idempotencyKey?: string;
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

  // The account ID comes from the authenticated site resolver. Once the
  // additive backfill has run, the database relation is the final authority;
  // a legacy restaurant can still use the historical single-site path.
  const accountId = restaurant.accountId ?? input.accountId;
  const accountBilling = accountId
    ? await db.restaurantAccountBilling.findUnique({ where: { accountId } })
    : null;
  const billingAnchor = accountId
    ? ((await db.restaurant.findFirst({
        where: { accountId, isPrimary: true, siteStatus: { not: 'ARCHIVED' } },
      })) ?? restaurant)
    : restaurant;
  const idempotencyKey = buildCheckoutIdempotencyKey({
    ...input,
    restaurantId: billingAnchor.id,
    scopeId: accountId,
    siteCount,
  });

  const billing = await db.restaurantBilling.findUnique({
    where: { restaurantId: billingAnchor.id },
  });
  if (
    (accountBilling?.stripeSubscriptionId &&
      ['active', 'trialing', 'past_due'].includes(accountBilling.subscriptionStatus ?? '')) ||
    (billing?.stripeSubscriptionId &&
      ['active', 'trialing', 'past_due'].includes(billing.subscriptionStatus ?? ''))
  ) {
    throw new BillingAlreadySubscribedError();
  }
  if (
    billing?.checkoutIdempotencyKey === idempotencyKey &&
    billing.checkoutSessionId &&
    billing.checkoutSessionUrl
  ) {
    return { id: billing.checkoutSessionId, url: billing.checkoutSessionUrl };
  }
  let customerId = accountBilling?.stripeCustomerId ?? billing?.stripeCustomerId ?? null;
  const stripe = getStripe();

  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        name: billingAnchor.name,
        email: normalizeEmail(billingAnchor.managerEmail),
        metadata: {
          restaurantId: restaurant.id,
          ...(accountId ? { accountId } : {}),
        },
      },
      {
        idempotencyKey: `sokar-customer-${createHash('sha256')
          .update(accountId ?? billingAnchor.id)
          .digest('hex')
          .slice(0, 48)}`,
      },
    );
    customerId = customer.id;
    await db.restaurantBilling.upsert({
      where: { restaurantId: billingAnchor.id },
      create: { restaurantId: billingAnchor.id, stripeCustomerId: customerId },
      update: { stripeCustomerId: customerId },
    });
  }

  try {
    const lineItems = [
      { price: priceId, quantity: 1 },
      ...(addonPriceId ? [{ price: addonPriceId, quantity: siteCount - 1 }] : []),
    ];
    const session = await stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        client_reference_id: restaurant.id,
        line_items: lineItems,
        metadata: {
          restaurantId: restaurant.id,
          ...(accountId ? { accountId } : {}),
          plan: input.plan,
          billing: input.billing,
          siteCount: String(siteCount),
        },
        subscription_data: {
          metadata: {
            restaurantId: restaurant.id,
            ...(accountId ? { accountId } : {}),
            plan: input.plan,
            billing: input.billing,
            siteCount: String(siteCount),
          },
        },
        success_url: dashboardUrl(
          '/dashboard/settings?billing=success&session_id={CHECKOUT_SESSION_ID}',
        ),
        cancel_url: dashboardUrl('/pricing?billing=cancelled'),
      },
      { idempotencyKey },
    );

    if (!session.url) throw new BillingCheckoutError();
    await db.restaurantBilling.update({
      where: { restaurantId: billingAnchor.id },
      data: {
        checkoutIdempotencyKey: idempotencyKey,
        checkoutSessionId: session.id,
        checkoutSessionUrl: session.url,
        checkoutPlan: input.plan,
        checkoutBillingInterval: input.billing,
        checkoutSiteCount: siteCount,
        checkoutCreatedAt: new Date(),
      },
    });
    return { id: session.id, url: session.url };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await db.restaurantBilling.findUnique({
        where: { restaurantId: billingAnchor.id },
      });
      if (
        existing?.checkoutIdempotencyKey === idempotencyKey &&
        existing.checkoutSessionId &&
        existing.checkoutSessionUrl
      ) {
        return { id: existing.checkoutSessionId, url: existing.checkoutSessionUrl };
      }
    }
    if (error instanceof BillingCheckoutError) throw error;
    logger.error(
      { err: error instanceof Error ? error.message : String(error), restaurantId: restaurant.id },
      '[billing] Stripe Checkout session creation failed',
    );
    throw new BillingCheckoutError();
  }
}

/**
 * Opens Stripe's hosted customer portal. Billing remains account-scoped for
 * multi-site customers, while legacy restaurants keep their existing billing
 * row until the backfill is complete.
 */
export async function createBillingPortalSession(input: {
  restaurantId: string;
  accountId?: string;
}): Promise<{ url: string }> {
  const restaurant = await db.restaurant.findUnique({ where: { id: input.restaurantId } });
  if (!restaurant) throw new BillingRestaurantNotFoundError();

  const accountId = restaurant.accountId ?? input.accountId;
  const accountBilling = accountId
    ? await db.restaurantAccountBilling.findUnique({ where: { accountId } })
    : null;
  const billingAnchor = accountId
    ? ((await db.restaurant.findFirst({
        where: { accountId, isPrimary: true, siteStatus: { not: 'ARCHIVED' } },
      })) ?? restaurant)
    : restaurant;
  const billing = await db.restaurantBilling.findUnique({
    where: { restaurantId: billingAnchor.id },
  });
  const customerId = accountBilling?.stripeCustomerId ?? billing?.stripeCustomerId;
  if (!customerId) throw new BillingCustomerNotFoundError();

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: customerId,
      return_url: dashboardUrl('/dashboard/settings?billing=portal-return'),
    });
    if (!session.url) throw new BillingCheckoutError();
    return { url: session.url };
  } catch (error) {
    if (error instanceof BillingCheckoutError) throw error;
    logger.error(
      { err: error instanceof Error ? error.message : String(error), accountId: accountId ?? null },
      '[billing] Stripe customer portal session creation failed',
    );
    throw new BillingCheckoutError();
  }
}

type SubscriptionObject = Stripe.Subscription & {
  metadata: Record<string, string>;
};

type SupportedBillingEvent =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.paid'
  | 'invoice.payment_failed'
  | 'invoice.payment_succeeded';

type StripeEventClaim = 'claimed' | 'processed' | 'in-flight';

export class BillingWebhookInProgressError extends Error {
  readonly code = 'BILLING_WEBHOOK_IN_PROGRESS';

  constructor() {
    super('Stripe event is already being processed');
    this.name = 'BillingWebhookInProgressError';
  }
}

function eventCreated(event: Stripe.Event): number {
  return Number.isInteger(event.created) ? event.created : 0;
}

function eventId(event: Stripe.Event): string {
  return event.id || `synthetic:${event.type}:${eventCreated(event)}`;
}

function eventCheckpoint(event: Stripe.Event) {
  return {
    lastStripeEventCreated: eventCreated(event),
    lastStripeEventId: eventId(event),
  };
}

function clearCheckoutAttempt() {
  return {
    checkoutIdempotencyKey: null,
    checkoutSessionId: null,
    checkoutSessionUrl: null,
    checkoutPlan: null,
    checkoutBillingInterval: null,
    checkoutSiteCount: null,
    checkoutCreatedAt: null,
  };
}

async function isStaleStripeEvent(restaurantId: string, event: Stripe.Event): Promise<boolean> {
  const current = await db.restaurantBilling.findUnique({
    where: { restaurantId },
  });
  const lastCreated = current?.lastStripeEventCreated;
  const lastEventId = current?.lastStripeEventId;
  if (lastCreated === null || lastCreated === undefined) return false;

  const incomingCreated = eventCreated(event);
  if (incomingCreated < lastCreated) return true;
  return (
    incomingCreated === lastCreated &&
    Boolean(lastEventId) &&
    eventId(event) <= (lastEventId as string)
  );
}

/**
 * Claims a Stripe event before mutating billing state. A unique event ID
 * handles provider retries; a short processing lease lets a crashed attempt
 * be retried without permanently acknowledging the event.
 */
async function claimStripeEvent(event: Stripe.Event): Promise<StripeEventClaim> {
  const id = eventId(event);
  const now = new Date();
  const existing = await db.stripeWebhookEvent.findUnique({ where: { eventId: id } });

  if (existing?.status === 'processed') return 'processed';
  if (
    existing?.status === 'processing' &&
    existing.lastAttemptAt &&
    now.getTime() - existing.lastAttemptAt.getTime() < STRIPE_EVENT_PROCESSING_TIMEOUT_MS
  ) {
    return 'in-flight';
  }

  if (existing) {
    await db.stripeWebhookEvent.update({
      where: { eventId: id },
      data: {
        status: 'processing',
        attempts: { increment: 1 },
        lastAttemptAt: now,
        error: null,
      },
    });
    return 'claimed';
  }

  try {
    await db.stripeWebhookEvent.create({
      data: {
        eventId: id,
        eventType: event.type,
        eventCreated: eventCreated(event),
        status: 'processing',
        attempts: 1,
        lastAttemptAt: now,
      },
    });
    return 'claimed';
  } catch (error) {
    // Another worker won the unique insert. Re-read the ledger so a concurrent
    // delivery is retried instead of being acknowledged while the first worker
    // can still fail or crash.
    if (isUniqueViolation(error)) {
      const winner = await db.stripeWebhookEvent.findUnique({ where: { eventId: id } });
      if (winner?.status === 'processed') return 'processed';
      return 'in-flight';
    }
    throw error;
  }
}

async function markStripeEventProcessed(event: Stripe.Event): Promise<void> {
  await db.stripeWebhookEvent.update({
    where: { eventId: eventId(event) },
    data: { status: 'processed', processedAt: new Date(), error: null },
  });
}

async function markStripeEventFailed(event: Stripe.Event, error: unknown): Promise<void> {
  await db.stripeWebhookEvent.update({
    where: { eventId: eventId(event) },
    data: {
      status: 'failed',
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    },
  });
}

function subscriptionUpdateData(subscription: SubscriptionObject, deleted: boolean) {
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
  };
}

function metadataSiteCount(metadata: Record<string, string>): number {
  const parsed = Number(metadata.siteCount);
  return Number.isInteger(parsed) &&
    parsed >= MIN_MULTI_SITE_COUNT &&
    parsed <= MAX_MULTI_SITE_COUNT
    ? parsed
    : 1;
}

function metadataSiteCountOrUndefined(metadata: Record<string, string>): number | undefined {
  if (!metadata.siteCount) return undefined;
  const parsed = Number(metadata.siteCount);
  return Number.isInteger(parsed) &&
    parsed >= MIN_MULTI_SITE_COUNT &&
    parsed <= MAX_MULTI_SITE_COUNT
    ? parsed
    : undefined;
}

/**
 * Keep the multi-site entitlement at account scope. The historical
 * RestaurantBilling projection remains the source for single-site webhooks,
 * while this projection is what the site-management API uses for quotas.
 */
async function projectAccountBilling(
  restaurantId: string,
  data: {
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    subscriptionStatus?: string | null;
    subscriptionPriceId?: string | null;
    plan?: Plan;
    entitledSiteCount: number;
    subscriptionCurrentPeriodEnd?: Date | null;
    subscriptionCancelAtPeriodEnd?: boolean;
    lastStripeEventCreated: number;
    lastStripeEventId: string;
  },
): Promise<void> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { accountId: true },
  });
  if (!restaurant?.accountId) return;

  if (data.plan) {
    await db.restaurant.updateMany({
      where: { accountId: restaurant.accountId },
      data: { plan: data.plan },
    });
  }

  await db.restaurantAccountBilling.upsert({
    where: { accountId: restaurant.accountId },
    create: {
      accountId: restaurant.accountId,
      stripeCustomerId: data.stripeCustomerId ?? null,
      stripeSubscriptionId: data.stripeSubscriptionId ?? null,
      subscriptionStatus: data.subscriptionStatus ?? null,
      subscriptionPriceId: data.subscriptionPriceId ?? null,
      entitledSiteCount: data.entitledSiteCount,
      entitlementSource: 'STRIPE',
      subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd ?? null,
      subscriptionCancelAtPeriodEnd: data.subscriptionCancelAtPeriodEnd ?? false,
      lastStripeEventCreated: data.lastStripeEventCreated,
      lastStripeEventId: data.lastStripeEventId,
    },
    update: {
      stripeCustomerId: data.stripeCustomerId ?? undefined,
      stripeSubscriptionId: data.stripeSubscriptionId ?? undefined,
      subscriptionStatus: data.subscriptionStatus ?? undefined,
      subscriptionPriceId: data.subscriptionPriceId ?? undefined,
      entitledSiteCount: data.entitledSiteCount,
      entitlementSource: 'STRIPE',
      subscriptionCurrentPeriodEnd: data.subscriptionCurrentPeriodEnd ?? null,
      subscriptionCancelAtPeriodEnd: data.subscriptionCancelAtPeriodEnd ?? false,
      lastStripeEventCreated: data.lastStripeEventCreated,
      lastStripeEventId: data.lastStripeEventId,
    },
  });
}

async function handleCheckoutCompleted(event: Stripe.Event): Promise<boolean> {
  const session = event.data.object as Stripe.Checkout.Session;
  if (session.mode !== 'subscription') return false;
  const metadata = session.metadata ?? {};
  const restaurantId = metadata.restaurantId ?? session.client_reference_id ?? undefined;
  const plan = metadata.plan && isPublicBillingPlan(metadata.plan) ? metadata.plan : null;
  if (!restaurantId || !plan) return false;
  if (await isStaleStripeEvent(restaurantId, event)) return true;

  const subscriptionId = stripeObjectId(session.subscription);
  const customerId = stripeObjectId(session.customer);
  const billingInterval =
    metadata.billing && isBillingInterval(metadata.billing) ? metadata.billing : 'monthly';
  const siteCount = metadataSiteCount(metadata);
  await db.restaurant.update({
    where: { id: restaurantId },
    data: { plan: PLAN_TO_DATABASE[plan] },
  });
  // Project the account entitlement before advancing the legacy restaurant
  // checkpoint. If this write fails, Stripe can retry the event instead of
  // seeing a stale checkpoint and skipping the projection.
  await projectAccountBilling(restaurantId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: 'active',
    subscriptionPriceId: resolvePriceId(plan, billingInterval),
    plan: PLAN_TO_DATABASE[plan],
    entitledSiteCount: siteCount,
    lastStripeEventCreated: eventCreated(event),
    lastStripeEventId: eventId(event),
  });
  await db.restaurantBilling.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: 'active',
      subscriptionPriceId: resolvePriceId(plan, billingInterval),
      ...eventCheckpoint(event),
      ...clearCheckoutAttempt(),
    },
    update: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
      subscriptionStatus: 'active',
      subscriptionPriceId: resolvePriceId(plan, billingInterval),
      ...eventCheckpoint(event),
      ...clearCheckoutAttempt(),
    },
  });
  return true;
}

async function handleSubscriptionEvent(
  event: Stripe.Event,
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
  if (await isStaleStripeEvent(restaurantId, event)) return true;

  const priceId = subscription.items.data[0]?.price?.id;
  const planFromMetadata =
    metadata.plan && isPublicBillingPlan(metadata.plan) ? metadata.plan : null;
  const plan = planFromMetadata ?? (priceId ? getPublicPlanFromPriceId(priceId) : null);
  const deleted = eventType === 'customer.subscription.deleted';
  const billingData = subscriptionUpdateData(subscription, deleted);
  const siteCount = deleted ? 1 : metadataSiteCount(metadata);
  if (plan && deleted) {
    await db.restaurant.update({ where: { id: restaurantId }, data: { plan: 'STARTER' } });
  } else if (plan && eventType !== 'customer.subscription.deleted') {
    await db.restaurant.update({
      where: { id: restaurantId },
      data: { plan: PLAN_TO_DATABASE[plan] },
    });
  }
  // Keep this projection ahead of the legacy checkpoint for the same retry
  // reason as checkout.session.completed above.
  await projectAccountBilling(restaurantId, {
    ...billingData,
    plan: plan ? (deleted ? 'STARTER' : PLAN_TO_DATABASE[plan]) : undefined,
    entitledSiteCount: siteCount,
    lastStripeEventCreated: eventCreated(event),
    lastStripeEventId: eventId(event),
  });
  await db.restaurantBilling.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      ...billingData,
      ...clearCheckoutAttempt(),
      ...eventCheckpoint(event),
    },
    update: { ...billingData, ...clearCheckoutAttempt(), ...eventCheckpoint(event) },
  });
  return true;
}

type InvoiceObject = Stripe.Invoice & {
  metadata?: Record<string, string> | null;
};

type InvoiceBillingRecord = {
  restaurantId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  subscriptionStatus?: string | null;
  subscriptionPriceId?: string | null;
  subscriptionCurrentPeriodEnd?: Date | null;
  subscriptionCancelAtPeriodEnd?: boolean;
};

function invoicePriceId(invoice: InvoiceObject): string | undefined {
  const line = invoice.lines?.data?.[0] as { price?: string | { id: string } | null } | undefined;
  return stripeObjectId(line?.price) ?? undefined;
}

function invoicePeriodEnd(invoice: InvoiceObject): Date | undefined {
  return Number.isInteger(invoice.period_end) && invoice.period_end > 0
    ? new Date(invoice.period_end * 1000)
    : undefined;
}

async function findBillingForInvoice(
  invoice: InvoiceObject,
): Promise<{ billing: InvoiceBillingRecord | null; restaurantId: string } | null> {
  const subscriptionId = stripeObjectId(invoice.subscription);
  const customerId = stripeObjectId(invoice.customer);
  let billing = subscriptionId
    ? ((await db.restaurantBilling.findUnique({
        where: { stripeSubscriptionId: subscriptionId },
      })) as InvoiceBillingRecord | null)
    : null;

  if (!billing && customerId) {
    billing = (await db.restaurantBilling.findUnique({
      where: { stripeCustomerId: customerId },
    })) as InvoiceBillingRecord | null;
  }

  const metadata = (invoice.metadata ?? {}) as Record<string, string>;
  const restaurantId = billing?.restaurantId ?? metadata.restaurantId;
  if (!restaurantId) return null;
  return { billing, restaurantId };
}

async function findAccountBillingForRestaurant(restaurantId: string) {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { accountId: true },
  });
  if (!restaurant?.accountId) return null;
  return db.restaurantAccountBilling.findUnique({ where: { accountId: restaurant.accountId } });
}

/**
 * Stripe's Billing Portal owns proration and cancellation scheduling. These
 * invoice events keep Sokar's entitlement projection in sync with the
 * provider: a failed attempt enters the configured Stripe grace window as
 * `past_due`, a later `invoice.paid` reactivates it, and only
 * `customer.subscription.deleted` removes the plan.
 */
async function handleInvoiceEvent(
  event: Stripe.Event,
  eventType: 'invoice.paid' | 'invoice.payment_failed' | 'invoice.payment_succeeded',
): Promise<boolean> {
  const invoice = event.data.object as unknown as InvoiceObject;
  const resolved = await findBillingForInvoice(invoice);
  if (!resolved) return false;

  const { billing, restaurantId } = resolved;
  if (await isStaleStripeEvent(restaurantId, event)) return true;

  const metadata = (invoice.metadata ?? {}) as Record<string, string>;
  const customerId = stripeObjectId(invoice.customer) ?? billing?.stripeCustomerId ?? null;
  const subscriptionId =
    stripeObjectId(invoice.subscription) ?? billing?.stripeSubscriptionId ?? null;
  const priceId = invoicePriceId(invoice) ?? billing?.subscriptionPriceId ?? null;
  const planFromMetadata =
    metadata.plan && isPublicBillingPlan(metadata.plan) ? metadata.plan : null;
  const plan = planFromMetadata ?? (priceId ? getPublicPlanFromPriceId(priceId) : null);
  const accountBilling = await findAccountBillingForRestaurant(restaurantId);
  const siteCount =
    metadataSiteCountOrUndefined(metadata) ?? accountBilling?.entitledSiteCount ?? 1;
  const paid = eventType !== 'invoice.payment_failed';
  const status = paid ? 'active' : 'past_due';
  const periodEnd = invoicePeriodEnd(invoice) ?? billing?.subscriptionCurrentPeriodEnd ?? null;
  const cancelAtPeriodEnd = billing?.subscriptionCancelAtPeriodEnd ?? false;

  // A successful first or renewal invoice can carry the plan snapshot. A
  // failed attempt must leave the existing entitlement untouched during the
  // provider's grace window.
  if (paid && plan) {
    await db.restaurant.update({
      where: { id: restaurantId },
      data: { plan: PLAN_TO_DATABASE[plan] },
    });
  }

  await projectAccountBilling(restaurantId, {
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: status,
    subscriptionPriceId: priceId,
    plan: paid && plan ? PLAN_TO_DATABASE[plan] : undefined,
    entitledSiteCount: siteCount,
    subscriptionCurrentPeriodEnd: periodEnd,
    subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
    lastStripeEventCreated: eventCreated(event),
    lastStripeEventId: eventId(event),
  });

  await db.restaurantBilling.upsert({
    where: { restaurantId },
    create: {
      restaurantId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: status,
      subscriptionPriceId: priceId,
      subscriptionCurrentPeriodEnd: periodEnd,
      subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
      ...eventCheckpoint(event),
      ...clearCheckoutAttempt(),
    },
    update: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: subscriptionId ?? undefined,
      subscriptionStatus: status,
      subscriptionPriceId: priceId ?? undefined,
      subscriptionCurrentPeriodEnd: periodEnd ?? undefined,
      subscriptionCancelAtPeriodEnd: cancelAtPeriodEnd,
      ...eventCheckpoint(event),
      ...clearCheckoutAttempt(),
    },
  });

  return true;
}

/**
 * Applies only subscription events. Gift-card events remain handled by the
 * existing payment service. Returning false lets the webhook route log an
 * unknown/non-subscription event without mutating tenant billing state.
 */
export async function handleBillingWebhook(event: Stripe.Event): Promise<boolean> {
  const supported = new Set<SupportedBillingEvent>([
    'checkout.session.completed',
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.payment_succeeded',
  ]);
  if (!supported.has(event.type as SupportedBillingEvent)) return false;

  const claim = await claimStripeEvent(event);
  if (claim === 'processed') return true;
  if (claim === 'in-flight') throw new BillingWebhookInProgressError();

  try {
    const handled =
      event.type === 'checkout.session.completed'
        ? await handleCheckoutCompleted(event)
        : event.type === 'invoice.paid' ||
            event.type === 'invoice.payment_failed' ||
            event.type === 'invoice.payment_succeeded'
          ? await handleInvoiceEvent(event, event.type)
          : await handleSubscriptionEvent(
              event,
              event.type as Exclude<
                SupportedBillingEvent,
                | 'checkout.session.completed'
                | 'invoice.paid'
                | 'invoice.payment_failed'
                | 'invoice.payment_succeeded'
              >,
              event.data.object as unknown as SubscriptionObject,
            );
    await markStripeEventProcessed(event);
    return handled;
  } catch (error) {
    try {
      await markStripeEventFailed(event, error);
    } catch (markError) {
      logger.error(
        { err: markError instanceof Error ? markError.message : String(markError) },
        '[billing] Failed to record Stripe event failure',
      );
    }
    throw error;
  }
}
