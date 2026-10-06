import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServiceCopilotWidget from './ServiceCopilotWidget';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  orgId: 'restaurant-test',
}));

vi.mock('@/lib/api', () => ({ useApi: () => mocks }));

describe('ServiceCopilotWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('distingue une panne de la réponse vide et permet de réessayer', async () => {
    mocks.get
      .mockRejectedValueOnce(new Error('réseau'))
      .mockResolvedValueOnce({ recommendations: [] });
    render(<ServiceCopilotWidget />);

    expect(await screen.findByText('Recommandations indisponibles')).toBeInTheDocument();
    expect(screen.queryByText('Aucune action à traiter')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Aucune action à traiter')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('garde la recommandation et affiche une erreur quand son action échoue', async () => {
    mocks.get.mockResolvedValue({
      recommendations: [
        {
          id: 'rec-1',
          occurrenceKey: 'rec-1',
          ruleVersion: 'v1',
          kind: 'server-rebalance',
          priority: 'medium',
          title: 'Répartir le service',
          reason: 'Charge inégale',
          action: { type: 'api', method: 'POST', path: 'action-test', label: 'Confier la table' },
          expiresAt: '2099-01-01T00:00:00.000Z',
          metrics: {},
        },
      ],
    });
    mocks.post.mockRejectedValue(new Error('réseau'));
    render(<ServiceCopilotWidget />);
    fireEvent.click(await screen.findByRole('button', { name: 'Confier la table' }));
    // Server rebalance is confirmed before submission.
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer l’affectation' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Action non effectuée'),
    );
    expect(screen.getByText('Répartir le service')).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('condense les répétitions dans Salle sans modifier la lecture Pilotage', async () => {
    const recommendation = {
      id: 'rec-late',
      occurrenceKey: 'rec-late',
      ruleVersion: 'v1',
      kind: 'late-reservation',
      priority: 'high',
      title: 'Camille Martin est en retard de 20 min — appeler / marquer absent',
      reason: "Le client n'est pas arrivé et le créneau a débuté il y a 20 minutes.",
      action: { type: 'link', href: '/dashboard/reservations', label: 'Ouvrir les réservations' },
      expiresAt: '2099-01-01T00:00:00.000Z',
      metrics: { minutesLate: 20 },
    };
    mocks.get.mockResolvedValue({ recommendations: [recommendation] });

    const salle = render(<ServiceCopilotWidget density="service" showCalm={false} />);
    expect(await screen.findByText('Camille Martin est en retard de 20 min')).toBeInTheDocument();
    expect(screen.queryByText('20 min de retard')).not.toBeInTheDocument();
    expect(screen.queryByText(recommendation.reason)).not.toBeInTheDocument();

    salle.unmount();
    render(<ServiceCopilotWidget />);
    expect(await screen.findByText(recommendation.title)).toBeInTheDocument();
    expect(screen.getByText('20 min de retard')).toBeInTheDocument();
  });
});
