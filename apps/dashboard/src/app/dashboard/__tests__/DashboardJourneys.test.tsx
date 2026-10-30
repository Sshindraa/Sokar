import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DashboardPage from '../page';

const api = vi.hoisted(() => ({
  orgId: 'real-restaurant',
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ useApi: () => api }));
vi.mock('@/lib/use-service-copilot-access', () => ({
  useServiceCopilotAccess: () => ({ allowed: true, loading: false, error: false, retry: vi.fn() }),
}));
vi.mock('../DashboardCharts', () => ({ default: () => null }));

function scenario({ reservations = 0, calls = 12, recommendations = [] as object[] } = {}) {
  api.get.mockImplementation(async (path: string) => {
    if (path.includes('/service-copilot/recommendations')) return { recommendations };
    if (path.startsWith('dashboard/stats?'))
      return {
        total_calls: calls,
        total_reservations: reservations,
        call_reservations: 0,
        covers: reservations * 2,
        estimated_revenue: reservations * 70,
        by_channel: [],
      };
    if (path.startsWith('dashboard/analytics?')) return { data: [] };
    if (path === 'dashboard/empty-slots') return { days: [] };
    if (path === 'dashboard/no-show-stats') return { total: 0 };
    throw new Error(`Requête inattendue : ${path}`);
  });
}

describe('Pilotage — situations de travail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('une journée de renseignements reste calme, sans assimiler zéro réservation à un échec', async () => {
    scenario();
    render(<DashboardPage />);
    expect(
      await screen.findByRole('article', { name: 'Indicateur Réservations' }),
    ).toHaveTextContent('0');
    expect(screen.queryByRole('heading', { name: /À vérifier/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/avec une erreur enregistrée/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Copilot opérationnel')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Activité Sokar' })).not.toBeInTheDocument();
  });

  it('les vrais points à vérifier se déplient sans occuper l’accueil', async () => {
    scenario({
      calls: 5,
      recommendations: [
        {
          id: 'late-1',
          kind: 'late-reservation',
          priority: 'critical',
          title: 'Client en retard',
          reason: 'Le client n’est pas arrivé.',
          metrics: { minutesLate: 40 },
          action: { type: 'link', label: 'Vérifier l’arrivée', href: '/dashboard/reservations' },
        },
      ],
    });
    render(<DashboardPage />);
    const summary = await screen.findByText('1 point à vérifier dans Salle');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    fireEvent.click(summary);
    expect(screen.getByRole('heading', { name: 'Arrivée à vérifier' })).toBeInTheDocument();
    expect(screen.getByText(/Créneau commencé il y a 40 min/)).toBeInTheDocument();
    expect(screen.queryByText('Le client n’est pas arrivé.')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vérifier l’arrivée' })).toHaveAttribute(
      'href',
      '/dashboard/reservations',
    );
  });

  it('une faible activité reste descriptive et donne accès aux limites de l’estimation', async () => {
    scenario({ reservations: 2, calls: 2 });
    render(<DashboardPage />);
    const reservations = await screen.findByRole('article', {
      name: 'Indicateur Réservations',
    });
    expect(reservations).toHaveTextContent('2');
    expect(
      screen.queryByText(/manque à gagner|revenus sauvés|semaine bien remplie/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Comprendre CA estimé' }));
    const dialog = screen.getByRole('dialog', { name: 'CA estimé' });
    expect(within(dialog).getByText(/ne mesure ni les encaissements/)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Ouvrir l’historique' })).toHaveAttribute(
      'href',
      '/dashboard/reservations',
    );
  });
});
