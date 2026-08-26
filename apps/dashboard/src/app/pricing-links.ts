export type PublicPlan = 'Essential' | 'Pro' | 'Multi-site';

const PLAN_SLUGS: Record<PublicPlan, string> = {
  Essential: 'essential',
  Pro: 'pro',
  'Multi-site': 'multi-site',
};

/**
 * Keeps the selected offer and billing cadence when a visitor starts signup.
 * The registration flow remains the source of truth for account creation; a
 * future checkout can consume the same query parameters without changing the
 * links on the public pricing pages.
 */
export function getPlanSignupHref(plan: PublicPlan, yearly: boolean): string {
  const params = new URLSearchParams({
    plan: PLAN_SLUGS[plan],
    billing: yearly ? 'annual' : 'monthly',
  });

  return `/register?${params.toString()}`;
}
