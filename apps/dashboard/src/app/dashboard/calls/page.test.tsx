import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import CallsPage from './page';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  orgId: 'org_test',
  siteId: undefined as string | undefined,
}));

vi.mock('@/lib/api', () => ({
  useApi: () => mocks,
}));

vi.mock('@/lib/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

describe('CallsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propose un nouvel essai sans afficher une liste vide après une panne API', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('Impossible de joindre le serveur API'))
      .mockResolvedValueOnce({ data: [], total: 0 });

    render(<CallsPage />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Impossible de joindre le serveur API');
    expect(screen.queryByText('Aucun appel enregistré')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    await waitFor(() => {
      expect(screen.getByText('Aucun appel enregistré')).toBeInTheDocument();
    });
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });
});
