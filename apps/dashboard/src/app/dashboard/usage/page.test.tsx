import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UsagePage from './page';

const apiMocks = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get }),
}));

const current = {
  month: '2026-09',
  usage: [
    { category: 'TELEPHONY_SECONDS', quantity: '1250.000000' },
    { category: 'SMS_SEGMENTS', quantity: '12.000000' },
  ],
  included: { voiceMinutes: null, smsSegments: null },
  quotas: {
    voiceMinutes: {
      used: '20.833333',
      included: null,
      remaining: null,
      state: 'NOT_CONFIGURED',
    },
    smsSegments: {
      used: '12.000000',
      included: null,
      remaining: null,
      state: 'NOT_CONFIGURED',
    },
  },
};

describe('UsagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((path: string) => {
      if (path === 'usage/current') return Promise.resolve(current);
      return Promise.resolve({
        from: '2026-04',
        to: '2026-09',
        months: [
          {
            month: '2026-08',
            categories: [{ category: 'SMS_SEGMENTS', quantity: '4.000000' }],
          },
        ],
      });
    });
  });

  it('charge les volumes courants et l’historique sans exposer les coûts', async () => {
    render(<UsagePage />);

    expect(await screen.findByRole('heading', { name: 'Consommation' })).toBeInTheDocument();
    expect(screen.getAllByText('Sans quota')).toHaveLength(2);
    expect(screen.getByText('20,83')).toBeInTheDocument();
    expect(screen.getAllByText('12')).toHaveLength(2);
    expect(await screen.findByText('août 2026')).toBeInTheDocument();
    expect(screen.getByText(/Aucun quota ni blocage de service/)).toBeInTheDocument();
    expect(screen.queryByText(/PRICED|UNPRICED|0[,.]32/)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(apiMocks.get).toHaveBeenCalledWith('usage/current');
      expect(apiMocks.get).toHaveBeenCalledWith(
        expect.stringMatching(/^usage\/history\?from=\d{4}-\d{2}&to=\d{4}-\d{2}$/),
      );
    });
  });

  it('affiche un état d’erreur relançable', async () => {
    apiMocks.get.mockRejectedValue(new Error('Usage indisponible'));
    render(<UsagePage />);

    expect(await screen.findByText('Usage indisponible')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('convertit les secondes de voix pour une réponse API sans projection de quota', async () => {
    apiMocks.get.mockImplementation((path: string) =>
      Promise.resolve(
        path === 'usage/current'
          ? { month: '2026-09', usage: [{ category: 'TELEPHONY_SECONDS', quantity: '1250' }] }
          : { from: '2026-04', to: '2026-09', months: [] },
      ),
    );

    render(<UsagePage />);

    expect(await screen.findByText('20,83')).toBeInTheDocument();
  });
});
