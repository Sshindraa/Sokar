import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(process.cwd(), '../../scripts/ops/provision-stripe-catalog.mjs');

interface ProvisionedTarget {
  lookupKey: string;
  metadata: Record<string, string>;
}

interface ProvisioningModule {
  lookupKeyFor: (envName: string) => string;
  targetFor: (entry: {
    env: string;
    label: string;
    interval: string;
    amount: number;
  }) => ProvisionedTarget;
  creationFields: (target: ProvisionedTarget, productId: string) => Record<string, string>;
  reusablePriceProblems: (
    target: ProvisionedTarget,
    price: Record<string, unknown>,
    productId: string,
  ) => string[];
}

let module: ProvisioningModule;
let essential: ProvisionedTarget;

beforeAll(async () => {
  module = (await import(SCRIPT_PATH)) as ProvisioningModule;
  essential = module.targetFor({
    env: 'STRIPE_PRICE_ESSENTIAL_MONTHLY',
    label: 'Essential mensuel',
    interval: 'month',
    amount: 19900,
  });
});

function stripePrice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'price_catalog_v2',
    product: 'prod_essential',
    active: true,
    currency: 'eur',
    unit_amount: 19900,
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    billing_scheme: 'per_unit',
    metadata: essential.metadata,
    ...overrides,
  };
}

describe('provisionnement idempotent du catalogue Stripe', () => {
  it('attribue une lookup key stable, lisible et versionnée', () => {
    expect(module.lookupKeyFor('STRIPE_PRICE_ESSENTIAL_MONTHLY')).toBe(
      'sokar_essential_monthly_2026_09_199_299',
    );
  });

  it('crée un prix HT récurrent sur le produit existant', () => {
    expect(module.creationFields(essential, 'prod_essential')).toMatchObject({
      product: 'prod_essential',
      currency: 'eur',
      unit_amount: '19900',
      tax_behavior: 'exclusive',
      lookup_key: module.lookupKeyFor('STRIPE_PRICE_ESSENTIAL_MONTHLY'),
      'recurring[interval]': 'month',
      'recurring[interval_count]': '1',
      'metadata[sokar_catalog_version]': '2026-09-199-299',
      'metadata[sokar_plan]': 'essential',
    });
  });

  it('réutilise uniquement un prix entièrement conforme sur le même produit', () => {
    expect(module.reusablePriceProblems(essential, stripePrice(), 'prod_essential')).toEqual([]);
    expect(
      module.reusablePriceProblems(
        essential,
        stripePrice({ unit_amount: 14900 }),
        'prod_essential',
      ),
    ).toContain('montant 14900 au lieu de 19900 centimes');
    expect(
      module.reusablePriceProblems(
        essential,
        stripePrice({ product: 'prod_other' }),
        'prod_essential',
      ),
    ).toContain('produit différent de celui du prix source');
    expect(
      module.reusablePriceProblems(
        essential,
        stripePrice({ tax_behavior: 'inclusive' }),
        'prod_essential',
      ),
    ).toContain('tax_behavior inclusive au lieu de exclusive');
  });
});
