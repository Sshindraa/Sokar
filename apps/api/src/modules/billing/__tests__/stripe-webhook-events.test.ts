import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.resolve(
  process.cwd(),
  '../../scripts/ops/ensure-stripe-webhook-events.mjs',
);

let module: {
  REQUIRED_BILLING_EVENTS: string[];
  missingRequiredEvents: (events: string[]) => string[];
  mergedEnabledEvents: (events: string[]) => string[];
};

beforeAll(async () => {
  module = (await import(SCRIPT_PATH)) as typeof module;
});

describe('événements webhook Stripe de facturation', () => {
  it('couvre tout le cycle Checkout, abonnement, facture et recouvrement', () => {
    expect(module.REQUIRED_BILLING_EVENTS).toEqual([
      'checkout.session.completed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
      'invoice.paid',
      'invoice.payment_failed',
      'invoice.payment_succeeded',
    ]);
  });

  it('détecte les événements de facture absents même quand Checkout est présent', () => {
    expect(
      module.missingRequiredEvents([
        'checkout.session.completed',
        'customer.subscription.created',
        'customer.subscription.updated',
        'customer.subscription.deleted',
      ]),
    ).toEqual(['invoice.paid', 'invoice.payment_failed', 'invoice.payment_succeeded']);
  });

  it('préserve les événements existants et ajoute les événements billing sans doublon', () => {
    const events = module.mergedEnabledEvents(['payment_intent.succeeded', 'invoice.paid']);
    expect(events).toContain('payment_intent.succeeded');
    expect(events.filter((event) => event === 'invoice.paid')).toHaveLength(1);
    expect(module.missingRequiredEvents(events)).toEqual([]);
  });

  it('accepte le wildcard Stripe comme couverture complète', () => {
    expect(module.missingRequiredEvents(['*'])).toEqual([]);
  });
});
