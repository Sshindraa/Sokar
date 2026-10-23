export type PublicPlan = 'Essential' | 'Pro' | 'Multi-restaurant';

const PLAN_SLUGS: Record<PublicPlan, string> = {
  Essential: 'essential',
  Pro: 'pro',
  'Multi-restaurant': 'multi-site',
};

/**
 * Keeps the selected offer, billing cadence, and Multi-restaurant establishment count
 * when a visitor starts signup. The registration flow remains the source of
 * truth for account creation and forwards the selection to Checkout.
 */
export function getPlanSignupHref(plan: PublicPlan, yearly: boolean, siteCount = 2): string {
  const params = new URLSearchParams({
    plan: PLAN_SLUGS[plan],
    billing: yearly ? 'annual' : 'monthly',
  });

  if (plan === 'Multi-restaurant') params.set('sites', String(siteCount));

  return `/register?${params.toString()}`;
}

export function getPlanDemoHref(plan: PublicPlan, yearly: boolean, siteCount = 2): string {
  return getPlanSignupHref(plan, yearly, siteCount).replace('/register?', '/demo?');
}

export function readPricingSelection(search: string) {
  const params = new URLSearchParams(search);
  const plan = (Object.keys(PLAN_SLUGS) as PublicPlan[]).find(
    (label) => PLAN_SLUGS[label] === params.get('plan'),
  );
  if (!plan) return null;
  const count = Number(params.get('sites'));
  return {
    plan,
    yearly: params.get('billing') !== 'monthly',
    siteCount: Number.isInteger(count) && count >= 1 && count <= 100 ? count : 2,
  };
}
