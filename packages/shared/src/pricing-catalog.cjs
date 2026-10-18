/** Shared by TypeScript applications and unbuilt Node ops scripts. All billing is in cents. */
const ANNUAL_DISCOUNT_PERCENT = 10;
const PRICING_CATALOG_VERSION = '2026-10-10-percent';

/** @param {number} monthlyCents */
function annualPriceCents(monthlyCents) {
  return Math.round((monthlyCents * 12 * (100 - ANNUAL_DISCOUNT_PERCENT)) / 100);
}

const PRICING_CATALOG = {
  essential: { monthlyCents: 19900, label: 'Essential', stripeSuffix: 'ESSENTIAL' },
  pro: { monthlyCents: 29900, label: 'Pro', stripeSuffix: 'PRO' },
  'multi-site': { monthlyCents: 29900, label: 'Multi-site (base)', stripeSuffix: 'MULTI_SITE' },
  'multi-site-addon': {
    monthlyCents: 9900,
    label: 'Multi-site (site sup.)',
    stripeSuffix: 'MULTI_SITE_ADDON',
  },
};

/**
 * Exact invoice amount, never derived from display rounding.
 * @param {'essential' | 'pro' | 'multi-site'} plan
 * @param {boolean} yearly
 * @param {number} [siteCount]
 */
function pricingTotalCents(plan, yearly, siteCount = 1) {
  if (!Number.isInteger(siteCount) || siteCount < 1 || siteCount > 100) {
    throw new RangeError('Nombre d’établissements invalide');
  }
  const base = PRICING_CATALOG[plan].monthlyCents;
  const addon =
    plan === 'multi-site' ? (siteCount - 1) * PRICING_CATALOG['multi-site-addon'].monthlyCents : 0;
  return yearly
    ? annualPriceCents(base) +
        (plan === 'multi-site'
          ? (siteCount - 1) * annualPriceCents(PRICING_CATALOG['multi-site-addon'].monthlyCents)
          : 0)
    : base + addon;
}

/** @param {number} cents */
function formatPriceCents(cents) {
  return (cents / 100).toLocaleString('fr-FR', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Display only: round the exact total after conversion to its monthly equivalent.
 * @param {number} totalCents
 * @param {boolean} yearly
 */
function formatMonthlyEquivalent(totalCents, yearly) {
  return Math.round(totalCents / (yearly ? 1200 : 100)).toLocaleString('fr-FR');
}

module.exports = {
  ANNUAL_DISCOUNT_PERCENT,
  PRICING_CATALOG_VERSION,
  PRICING_CATALOG,
  annualPriceCents,
  pricingTotalCents,
  formatPriceCents,
  formatMonthlyEquivalent,
};
