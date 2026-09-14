import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GiftCardsPage from './page';

const mocks = vi.hoisted(() => ({
  listGiftCards: vi.fn(),
  getGiftCardStats: vi.fn(),
  listGiftCardPacks: vi.fn(),
  cancelGiftCard: vi.fn(),
  closeCrowdfunding: vi.fn(),
  get: vi.fn(),
  patch: vi.fn(),
  orgId: 'org_test',
}));

vi.mock('@/lib/api/gift-cards', () => ({
  useGiftCardApi: () => ({
    listGiftCards: mocks.listGiftCards,
    getGiftCardStats: mocks.getGiftCardStats,
    listGiftCardPacks: mocks.listGiftCardPacks,
    cancelGiftCard: mocks.cancelGiftCard,
    closeCrowdfunding: mocks.closeCrowdfunding,
    orgId: mocks.orgId,
  }),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: mocks.get, patch: mocks.patch }),
}));

vi.mock('@/components/gift-cards/GiftCardSectionNav', () => ({
  GiftCardSectionNav: () => <nav aria-label="Cartes cadeaux" />,
}));

vi.mock('@/components/gift-cards/gift-card-form', () => ({
  default: () => null,
}));

vi.mock('@/components/gift-cards/gift-card-list', () => ({
  default: () => <p>liste prête</p>,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

describe('GiftCardsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listGiftCards
      .mockRejectedValueOnce(new Error('Impossible de joindre le serveur API'))
      .mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    mocks.getGiftCardStats.mockResolvedValue({
      totalSoldAmount: 0,
      totalRemainingAmount: 0,
      redeemedCount: 0,
      activeCount: 0,
      totalCount: 0,
      averageAmount: 0,
      packCount: 0,
      freeAmountCount: 0,
    });
    mocks.listGiftCardPacks.mockResolvedValue([]);
    mocks.get.mockResolvedValue({ giftCardMinimumAmount: null, giftCardCommissionRate: null });
  });

  it('ne boucle pas sur les appels et permet de réessayer après une panne', async () => {
    render(<GiftCardsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de joindre le serveur API',
    );
    expect(screen.queryByText('liste prête')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('liste prête')).toBeInTheDocument();
    });
    expect(mocks.listGiftCards).toHaveBeenCalledTimes(2);
  });
});
