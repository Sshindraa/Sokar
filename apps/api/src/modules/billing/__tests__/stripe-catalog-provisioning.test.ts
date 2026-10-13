import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const SCRIPT_PATH = path.resolve(process.cwd(), '../../scripts/ops/provision-stripe-catalog.mjs');

interface ProvisionedTarget {
  lookupKey: string;
  metadata: Record<string, string>;
}

interface ProvisioningModule {
  main: (argv: string[], environment: Record<string, string>) => Promise<number>;
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
      'sokar_essential_monthly_2026_10_10_percent',
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
      'metadata[sokar_catalog_version]': '2026-10-10-percent',
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

describe('création additive de la nouvelle grille', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('réutilise trois mensuels, crée cinq prix sur les produits sources et ne touche aucun abonnement', async () => {
    const suffixes = [
      'ESSENTIAL_MONTHLY',
      'ESSENTIAL_ANNUAL',
      'PRO_MONTHLY',
      'PRO_ANNUAL',
      'MULTI_SITE_MONTHLY',
      'MULTI_SITE_ANNUAL',
      'MULTI_SITE_ADDON_MONTHLY',
      'MULTI_SITE_ADDON_ANNUAL',
    ];
    const oldAmounts = [19900, 191040, 29900, 287040, 24900, 239040, 9900, 95040];
    const environment: Record<string, string> = { STRIPE_SECRET_KEY: 'sk_test_unit' };
    const sources = new Map(
      suffixes.map((suffix, index) => {
        const id = `price_source_${index}`;
        environment[`STRIPE_PRICE_${suffix}`] = id;
        return [
          id,
          {
            id,
            active: true,
            product: `prod_${Math.floor(index / 2)}`,
            currency: 'eur',
            unit_amount: oldAmounts[index],
            recurring: {
              interval: suffix.endsWith('MONTHLY') ? 'month' : 'year',
              interval_count: 1,
            },
            tax_behavior: 'exclusive',
            billing_scheme: 'per_unit',
          },
        ];
      }),
    );
    const mutations: URLSearchParams[] = [];
    const fetchMock = vi.fn(
      async (url: string, options: { method?: string; body?: URLSearchParams } = {}) => {
        if (options.method === 'POST') {
          expect(url).toBe('https://api.stripe.com/v1/prices');
          const fields = options.body!;
          mutations.push(fields);
          const metadata = Object.fromEntries(
            [...fields]
              .filter(([key]) => key.startsWith('metadata['))
              .map(([key, value]) => [key.slice(9, -1), value]),
          );
          return {
            ok: true,
            json: async () => ({
              id: `price_created_${mutations.length}`,
              active: true,
              product: fields.get('product'),
              currency: 'eur',
              unit_amount: Number(fields.get('unit_amount')),
              recurring: { interval: fields.get('recurring[interval]'), interval_count: 1 },
              tax_behavior: 'exclusive',
              billing_scheme: 'per_unit',
              metadata,
            }),
          };
        }
        const id = url.split('/').at(-1)!;
        return { ok: true, json: async () => sources.get(id) ?? { data: [] } };
      },
    );
    vi.stubGlobal('fetch', fetchMock);
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await module.main(['--apply', '--json'], environment)).toBe(0);
      expect(mutations.map((fields) => Number(fields.get('unit_amount')))).toEqual([
        214920, 322920, 29900, 322920, 106920,
      ]);
      expect(mutations.map((fields) => fields.get('product'))).toEqual([
        'prod_0',
        'prod_1',
        'prod_2',
        'prod_2',
        'prod_3',
      ]);
      const result = JSON.parse(String(stdout.mock.calls.at(-1)?.[0]));
      expect(
        result.rows
          .filter((row: { status: string }) => row.status === 'source inchangée réutilisée')
          .map((row: { priceId: string }) => row.priceId),
      ).toEqual(['price_source_0', 'price_source_2', 'price_source_6']);
    } finally {
      stdout.mockRestore();
    }
  });
});
