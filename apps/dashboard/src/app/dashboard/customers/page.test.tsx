import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CustomersPage from './page';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  orgId: 'org_test',
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

describe('CustomersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propose un nouvel essai sans afficher une liste vide après une panne API', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('Impossible de joindre le serveur API'))
      .mockResolvedValueOnce({ data: [] });

    render(<CustomersPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impossible de joindre le serveur API');
    expect(screen.queryByText('Aucun client enregistré')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucun client enregistré')).toBeInTheDocument();
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('affiche les clients renvoyés dans l’enveloppe API data', async () => {
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          restaurantId: 'org_test',
          phone: '+33600000000',
          name: 'Alice Demo',
          visitCount: 3,
          loyaltyScore: '8.5',
          isVip: false,
        },
      ],
      total: 1,
      limit: 50,
      offset: 0,
    });

    render(<CustomersPage />);

    expect(await screen.findByText('Alice Demo')).toBeInTheDocument();
    expect(screen.getByText('1 client')).toBeInTheDocument();
    expect(screen.queryByText('Aucun client enregistré')).not.toBeInTheDocument();
  });

  it('utilise la route POST de bascule VIP exposée par l’API', async () => {
    mocks.get.mockResolvedValueOnce({
      data: [
        {
          id: 'customer-1',
          restaurantId: 'org_test',
          phone: '+33600000000',
          name: 'Alice Demo',
          visitCount: 3,
          loyaltyScore: '8.5',
          isVip: false,
        },
      ],
    });
    mocks.post.mockResolvedValueOnce({ isVip: true });

    render(<CustomersPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter' }));

    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledWith('customers/customer-1/vip', { isVip: true });
    });
  });
});
