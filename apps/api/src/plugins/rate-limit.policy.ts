/**
 * Rate-limit policy for Sokar's public surfaces.
 *
 * `@fastify/rate-limit` applies the global limit (see `rate-limit.ts`) to every
 * route. A route that declares `config.rateLimit` **overrides** the global
 * settings for itself, which is how the tiers below are applied.
 *
 * Tiers, from most permissive to most restrictive:
 *
 * - USER_READ / USER_WRITE — 600 / 120 req/min per signed-in Clerk user, in
 *   two separate counters. Several floor screens on one restaurant router no
 *   longer share an IP budget, and polling reads never starve a staff action.
 *   One account is often shared by every device of a restaurant: a Salle screen
 *   polls ~24 reads/min, so 600 covers a large room with headroom.
 *
 * - GLOBAL — 100 req/min/IP. Default for anonymous traffic (no Clerk session).
 *
 * - PROVIDER_WEBHOOK — 600 req/min/IP. Callbacks authenticated by signature
 *   (Telnyx voice/SMS/WhatsApp, Stripe billing and reservation payments). A
 *   legitimate burst must never be answered with 429: a throttled callback
 *   delays a call, an SMS or a payment reconciliation. The limit stays finite
 *   as a safety net against unauthenticated floods, since signature
 *   verification still costs CPU per request.
 *
 * - PUBLIC_TOKEN — 30 req/min/IP. Unauthenticated endpoints guarded only by an
 *   opaque token (marketing click and unsubscribe). The limit blunts token
 *   brute force without blocking a real customer clicking a link twice.
 *
 * - PUBLIC_READ — 120 req/min/IP. Public catalog and checkout status reads,
 *   including short-lived payment confirmation polling.
 *
 * - PUBLIC_WRITE — 20 req/min/IP. Unauthenticated writes that create or mutate
 *   state (reputation feedback submission).
 *
 * Endpoints that carry their own application-level limiter (RGPD, gift-card
 * payment intents, MCP OAuth) keep their dedicated budget and are not listed
 * here.
 */

export const RATE_LIMIT_WINDOW = '1 minute';

export const RATE_LIMIT_GLOBAL_MAX = 100;

export const RATE_LIMIT_USER_READ_MAX = 600;

export const RATE_LIMIT_USER_WRITE_MAX = 120;

export const RATE_LIMIT_PROVIDER_WEBHOOK = {
  max: 600,
  timeWindow: RATE_LIMIT_WINDOW,
};

export const RATE_LIMIT_PUBLIC_TOKEN = {
  max: 30,
  timeWindow: RATE_LIMIT_WINDOW,
};

export const RATE_LIMIT_PUBLIC_READ = {
  max: 120,
  timeWindow: RATE_LIMIT_WINDOW,
};

export const RATE_LIMIT_PUBLIC_WRITE = {
  max: 20,
  timeWindow: RATE_LIMIT_WINDOW,
};
