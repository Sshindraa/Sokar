export type PublicPlan = 'Essential' | 'Pro' | 'Multi-site';

const PLAN_SLUGS: Record<PublicPlan, string> = {
  Essential: 'essential',
  Pro: 'pro',
  'Multi-site': 'multi-site',
};

/**
 * Keeps the selected offer, billing cadence, and Multi-site establishment count
 * when a visitor starts signup. The registration flow remains the source of
 * truth for account creation and forwards the selection to Checkout.
 */
export function getPlanSignupHref(plan: PublicPlan, yearly: boolean, siteCount = 2): string {
  const params = new URLSearchParams({
    plan: PLAN_SLUGS[plan],
    billing: yearly ? 'annual' : 'monthly',
  });

  if (plan === 'Multi-site') params.set('sites', String(siteCount));

  return `/register?${params.toString()}`;
}
