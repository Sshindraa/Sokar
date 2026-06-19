/**
 * Plan enum — mirror of Prisma `Plan` enum.
 *
 * Why a TS mirror instead of importing from `@prisma/client`?
 * - The dashboard (Next.js) should NOT depend on `@prisma/client`
 *   (it would pull the Prisma engine into the browser bundle).
 * - Server-side code CAN use Prisma's enum directly; this mirror
 *   is for shared use (display labels, form selects, type guards).
 *
 * Source of truth: `packages/database/prisma/schema.prisma` `enum Plan`.
 * If you add/remove a value there, mirror it here and run
 * `pnpm turbo typecheck` to surface every consumer.
 */

export const PLAN_VALUES = ['ESSENTIAL', 'STARTER', 'PRO', 'PREMIUM'] as const;
export type Plan = (typeof PLAN_VALUES)[number];

/**
 * Display label per plan code.
 * Use this anywhere user-facing (dashboard, emails, exports).
 * Keep in sync with packages/config/src/constants.ts PLANS (legacy map).
 */
export const PLAN_LABELS: Record<Plan, string> = {
  ESSENTIAL: 'Essential',
  STARTER: 'Essential', // legacy alias — DB still emits STARTER for old accounts
  PRO: 'Pro',
  PREMIUM: 'Multi-site',
};

/**
 * Public monthly price in EUR (HT). `null` = "sur devis" / enterprise.
 * Use this for pricing pages, upgrade CTAs, invoices.
 */
export const PLAN_PRICES_EUR: Record<Plan, number | null> = {
  ESSENTIAL: 149,
  STARTER: 149,
  PRO: 249,
  PREMIUM: 249,
};

/**
 * Discriminator for legacy vs new plan codes.
 * Use this when migrating data, never at runtime to make business decisions.
 */
export const PLAN_LEGACY: Record<Plan, boolean> = {
  ESSENTIAL: false,
  STARTER: true,
  PRO: false,
  PREMIUM: false,
};
