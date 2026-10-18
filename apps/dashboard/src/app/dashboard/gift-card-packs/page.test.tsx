import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('demande une confirmation propre à Sokar avant de supprimer un pack', async () => {
    const pack = {
      id: 'pack-1',
      name: 'Dîner pour deux',
      description: null,
      amount: 90,
      minPartySize: 2,
      maxPartySize: 2,
      isActive: true,
    };
    mocks.listGiftCardPacks.mockResolvedValue([pack]);
    mocks.deleteGiftCardPack.mockResolvedValue(undefined);
    const nativeConfirm = vi.spyOn(window, 'confirm');
    render(<GiftCardPacksPage />);

    fireEvent.click(await screen.findByRole('button', { name: /supprimer/i }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Supprimer ce pack ?');
    expect(dialog).toHaveTextContent('Dîner pour deux');
    expect(mocks.deleteGiftCardPack).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }));

    await waitFor(() => expect(mocks.deleteGiftCardPack).toHaveBeenCalledWith('pack-1'));
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('s’appelle « Packs cadeaux », comme l’onglet', async () => {
    mocks.listGiftCardPacks.mockResolvedValue([]);
    render(<GiftCardPacksPage />);

    expect(await screen.findByRole('heading', { name: 'Packs cadeaux' })).toBeInTheDocument();
  });
});
