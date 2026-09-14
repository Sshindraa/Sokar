import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GiftCardPacksPage from './page';

const mocks = vi.hoisted(() => ({
  listGiftCardPacks: vi.fn(),
  toggleGiftCardPack: vi.fn(),
  deleteGiftCardPack: vi.fn(),
  orgId: 'org_test',
}));

vi.mock('@/lib/api/gift-cards', () => ({
  useGiftCardApi: () => mocks,
}));

vi.mock('@/components/gift-cards/gift-card-pack-form', () => ({
  default: () => null,
}));

vi.mock('@/components/gift-cards/GiftCardSectionNav', () => ({
  GiftCardSectionNav: () => <nav aria-label="Cartes cadeaux" />,
}));

describe('GiftCardPacksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propose un nouvel essai sans afficher un faux état vide après une panne', async () => {
    mocks.listGiftCardPacks
      .mockRejectedValueOnce(new Error('Impossible de joindre le serveur API'))
      .mockResolvedValueOnce([]);

    render(<GiftCardPacksPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impossible de joindre le serveur API');
    expect(screen.queryByText('Aucun pack expérience pour le moment')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucun pack expérience pour le moment')).toBeInTheDocument();
    });
    expect(mocks.listGiftCardPacks).toHaveBeenCalledTimes(2);
  });
});
