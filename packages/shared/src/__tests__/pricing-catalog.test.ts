import { describe, expect, it } from 'vitest';
import {
  ANNUAL_DISCOUNT_PERCENT,
  PRICING_CATALOG,
  annualPriceCents,
  pricingTotalCents,
  formatMonthlyEquivalent,
  formatPriceCents,
} from '../pricing-catalog.cjs';

describe('catalogue de nouvelles souscriptions', () => {
  it('applique 10 % à chaque composant en centimes entiers', () => {
    expect(ANNUAL_DISCOUNT_PERCENT).toBe(10);
    expect(
      Object.values(PRICING_CATALOG).map((entry) => annualPriceCents(entry.monthlyCents)),
    ).toEqual([214920, 322920, 322920, 106920]);
    expect(formatMonthlyEquivalent(pricingTotalCents('essential', true), true)).toBe('179');
    expect(formatMonthlyEquivalent(pricingTotalCents('pro', true), true)).toBe('269');
    expect(
      formatMonthlyEquivalent(
        annualPriceCents(PRICING_CATALOG['multi-site-addon'].monthlyCents),
        true,
      ),
    ).toBe('89');
  });
  it.each([
    [1, 29900, 322920, '269'],
    [2, 39800, 429840, '358'],
    [3, 49700, 536760, '447'],
    // Summing rounded unit equivalents would give 714, but the exact total rounds to 715.
    [6, 79400, 857520, '715'],
  ])(
    'calcule le total exact pour %i établissements avant tout arrondi',
    (count, monthly, annual, equivalent) => {
      expect(pricingTotalCents('multi-site', false, count)).toBe(monthly);
      expect(pricingTotalCents('multi-site', true, count)).toBe(annual);
      expect(formatMonthlyEquivalent(annual, true)).toBe(equivalent);
    },
  );
  it('préserve les centimes au récapitulatif avant paiement', () => {
    expect(formatPriceCents(pricingTotalCents('multi-site', true, 3)).replace(/\s/g, ' ')).toBe(
      '5 367,60',
    );
    expect(formatPriceCents(pricingTotalCents('multi-site', false, 3))).toBe('497');
  });
  it.each([0, -1, 1.5, 101])('refuse un nombre invalide de sites : %s', (count) => {
    expect(() => pricingTotalCents('multi-site', true, count)).toThrow(RangeError);
  });
});
