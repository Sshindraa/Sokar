import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Page from './page';
vi.mock('@/lib/api-client', () => ({
  fetchWidgetRestaurant: vi.fn(async () => ({
    id: 'r1',
    slug: 'demo',
    name: 'Démo',
    giftCardEnabled: true,
  })),
}));
vi.mock('@/lib/tracking', () => ({ trackEventAsync: vi.fn() }));
vi.mock('@/components/gift-card-purchase', () => ({
  GiftCardPurchase: () => <div>Achat de carte</div>,
}));
vi.mock('@/components/gift-card-crowdfunding-page', () => ({
  GiftCardCrowdfundingPage: ({ code }: { code: string }) => <div>Contribution {code}</div>,
}));
describe('destination des liens cadeaux', () => {
  it('ouvre la contribution pour un lien partagé et non une nouvelle carte', async () => {
    render(
      await Page({
        params: Promise.resolve({ slug: 'demo' }),
        searchParams: Promise.resolve({ crowdfund: 'shared-test', embedded: '1' }),
      }),
    );
    expect(screen.getByText('Contribution shared-test')).toBeTruthy();
    expect(screen.queryByText('Achat de carte')).toBeNull();
  });
  it('conserve le parcours achat sans paramètre de contribution', async () => {
    render(
      await Page({ params: Promise.resolve({ slug: 'demo' }), searchParams: Promise.resolve({}) }),
    );
    expect(screen.getByText('Achat de carte')).toBeTruthy();
  });
});
