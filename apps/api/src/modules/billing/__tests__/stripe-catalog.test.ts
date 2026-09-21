import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Le contrôle du catalogue Stripe (porte P1_ESSENTIAL) vit dans un script ops,
 * hors du build TypeScript. Ce test verrouille sa logique de comparaison : sans
 * lui, une erreur de contrôle laisserait activer le checkout avec les anciens
 * prix 149/249 €.
 */
const SCRIPT_PATH = path.resolve(process.cwd(), '../../scripts/ops/verify-stripe-catalog.mjs');

interface ExpectedEntry {
  env: string;
  label: string;
  interval: string;
  amount: number | null;
}

let module: {
  EXPECTED_CATALOG: ExpectedEntry[];
  expectedAmountEnvName: (envName: string) => string;
  comparePrice: (
    expected: ExpectedEntry,
    actual: unknown,
    expectedAmount?: number | null,
  ) => string[];
};

beforeAll(async () => {
  module = (await import(SCRIPT_PATH)) as typeof module;
});

const ESSENTIAL_MONTHLY: ExpectedEntry = {
  env: 'STRIPE_PRICE_ESSENTIAL_MONTHLY',
  label: 'Essential mensuel',
  interval: 'month',
  amount: 19900,
};

function stripePrice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'price_x',
    active: true,
    currency: 'eur',
    unit_amount: 19900,
    recurring: { interval: 'month', interval_count: 1 },
    ...overrides,
  };
}

describe('catalogue Stripe attendu', () => {
  it('couvre les huit prix du produit', () => {
    expect(module.EXPECTED_CATALOG).toHaveLength(8);
    expect(module.EXPECTED_CATALOG.map((entry) => entry.env)).toEqual([
      'STRIPE_PRICE_ESSENTIAL_MONTHLY',
      'STRIPE_PRICE_ESSENTIAL_ANNUAL',
      'STRIPE_PRICE_PRO_MONTHLY',
      'STRIPE_PRICE_PRO_ANNUAL',
      'STRIPE_PRICE_MULTI_SITE_MONTHLY',
      'STRIPE_PRICE_MULTI_SITE_ANNUAL',
      'STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY',
      'STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL',
    ]);
  });

  it('fixe les montants mensuels du catalogue 199/299/249+99', () => {
    const amounts = Object.fromEntries(
      module.EXPECTED_CATALOG.map((entry) => [entry.env, entry.amount]),
    );
    expect(amounts.STRIPE_PRICE_ESSENTIAL_MONTHLY).toBe(19900);
    expect(amounts.STRIPE_PRICE_PRO_MONTHLY).toBe(29900);
    expect(amounts.STRIPE_PRICE_MULTI_SITE_MONTHLY).toBe(24900);
    expect(amounts.STRIPE_PRICE_MULTI_SITE_ADDON_MONTHLY).toBe(9900);
  });

  it('reprend la grille annuelle -20 % du runbook Stripe', () => {
    const amounts = Object.fromEntries(
      module.EXPECTED_CATALOG.map((entry) => [entry.env, entry.amount]),
    );
    const annual = module.EXPECTED_CATALOG.filter((entry) => entry.interval === 'year');
    expect(annual).toHaveLength(4);
    expect(amounts.STRIPE_PRICE_ESSENTIAL_ANNUAL).toBe(191040);
    expect(amounts.STRIPE_PRICE_PRO_ANNUAL).toBe(287040);
    expect(amounts.STRIPE_PRICE_MULTI_SITE_ANNUAL).toBe(239040);
    expect(amounts.STRIPE_PRICE_MULTI_SITE_ADDON_ANNUAL).toBe(95040);
  });

  it('dérive le nom de la variable de montant attendu', () => {
    expect(module.expectedAmountEnvName('STRIPE_PRICE_PRO_ANNUAL')).toBe(
      'STRIPE_EXPECTED_PRO_ANNUAL',
    );
  });
});

describe('comparePrice', () => {
  it('accepte un prix conforme', () => {
    expect(module.comparePrice(ESSENTIAL_MONTHLY, stripePrice(), 19900)).toEqual([]);
  });

  it('refuse l’ancien montant 149 €', () => {
    const problems = module.comparePrice(
      ESSENTIAL_MONTHLY,
      stripePrice({ unit_amount: 14900 }),
      19900,
    );
    expect(problems).toEqual(['montant 14900 au lieu de 19900 centimes']);
  });

  it('refuse une devise, une cadence ou un état non conformes', () => {
    expect(module.comparePrice(ESSENTIAL_MONTHLY, stripePrice({ currency: 'usd' }))).toEqual([
      'devise usd au lieu de eur',
    ]);
    expect(
      module.comparePrice(ESSENTIAL_MONTHLY, stripePrice({ recurring: { interval: 'year' } })),
    ).toEqual(['cadence year au lieu de month']);
    expect(module.comparePrice(ESSENTIAL_MONTHLY, stripePrice({ active: false }))).toEqual([
      'prix archivé (active=false)',
    ]);
  });

  it('signale un prix introuvable', () => {
    expect(module.comparePrice(ESSENTIAL_MONTHLY, { error: '404' })).toEqual([
      'prix introuvable côté Stripe (404)',
    ]);
  });

  it('ne contrôle pas le montant quand la référence est inconnue', () => {
    const annual: ExpectedEntry = { ...ESSENTIAL_MONTHLY, interval: 'year', amount: null };
    expect(
      module.comparePrice(annual, stripePrice({ recurring: { interval: 'year' } }), null),
    ).toEqual([]);
  });
});
