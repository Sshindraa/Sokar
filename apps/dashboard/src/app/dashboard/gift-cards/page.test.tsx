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

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
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
  default: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Créer une carte cadeau" /> : null,
}));

vi.mock('@/components/gift-cards/gift-card-list', () => ({
  default: () => <p>liste prête</p>,
}));

vi.mock('@/components/ConfirmDialog', () => ({
  ConfirmDialog: () => null,
}));

describe('GiftCardsPage', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/dashboard/gift-cards');
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

  it('ouvre le formulaire demandé après un chargement réussi, y compris après réessai', async () => {
    window.history.replaceState({}, '', '/dashboard/gift-cards?create=1');
    render(<GiftCardsPage />);
    await screen.findByRole('alert');
    expect(
      screen.queryByRole('dialog', { name: 'Créer une carte cadeau' }),
    ).not.toBeInTheDocument();
    expect(window.location.search).toBe('?create=1');
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(
      await screen.findByRole('dialog', { name: 'Créer une carte cadeau' }),
    ).toBeInTheDocument();
    expect(window.location.search).toBe('');
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

  it('ne relance pas la liste à chaque lettre : la recherche part à la validation', async () => {
    mocks.listGiftCards.mockReset();
    mocks.listGiftCards.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    render(<GiftCardsPage />);
    const field = await screen.findByPlaceholderText(/Rechercher par nom/);
    const callsBefore = mocks.listGiftCards.mock.calls.length;

    fireEvent.change(field, { target: { value: 'Marie' } });

    // La page et le champ restent en place, aucune requête n'est partie.
    expect(screen.getByPlaceholderText(/Rechercher par nom/)).toHaveValue('Marie');
    expect(mocks.listGiftCards.mock.calls.length).toBe(callsBefore);

    fireEvent.submit(field.closest('form') as HTMLFormElement);
    await waitFor(() =>
      expect(mocks.listGiftCards).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'Marie', offset: 0 }),
      ),
    );
    expect(screen.getByPlaceholderText(/Rechercher par nom/)).toBeInTheDocument();
  });

  it('ouvre le réglage Stripe quand on arrive depuis « Configurer Stripe »', async () => {
    window.history.replaceState({}, '', '/dashboard/gift-cards?settings=stripe');
    mocks.listGiftCards.mockReset();
    mocks.listGiftCards.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
    render(<GiftCardsPage />);

    await waitFor(() =>
      expect(document.getElementById('gift-card-stripe-connect')?.hasAttribute('open')).toBe(true),
    );
    expect(window.location.search).toBe('');
  });
});
