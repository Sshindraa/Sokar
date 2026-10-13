import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DemoRequestsPage from './page';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => api,
}));

const notifiedRequest = {
  id: 'dr_1',
  establishmentName: 'Le Bistrot du Coin',
  contactEmail: 'contact@bistrot.example',
  contactPhone: '+33 6 12 34 56 78',
  currentTool: 'Cahier',
  mainProblem: 'Appels pendant le service',
  status: 'NEW',
  notifiedAt: '2026-10-13T10:01:00.000Z',
  createdAt: '2026-10-13T10:00:00.000Z',
};

const unnotifiedRequest = {
  ...notifiedRequest,
  id: 'dr_2',
  establishmentName: 'La Table du Marché',
  contactPhone: null,
  currentTool: null,
  mainProblem: null,
  notifiedAt: null,
};

describe('DemoRequestsPage', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.patch.mockReset();
  });

  it('affiche chaque demande avec son état de notification', async () => {
    api.get.mockResolvedValue({ data: [notifiedRequest, unnotifiedRequest] });

    render(<DemoRequestsPage />);

    expect(await screen.findByText('Le Bistrot du Coin')).toBeInTheDocument();
    expect(screen.getByText('La Table du Marché')).toBeInTheDocument();
    expect(screen.getByText('Notifiée')).toBeInTheDocument();
    expect(screen.getByText('Notification non envoyée')).toBeInTheDocument();
  });

  it("enregistre le nouveau statut d'une demande", async () => {
    api.get.mockResolvedValue({ data: [notifiedRequest] });
    api.patch.mockResolvedValue({ data: { ...notifiedRequest, status: 'CONTACTED' } });

    render(<DemoRequestsPage />);
    const select = await screen.findByLabelText('Statut de Le Bistrot du Coin');
    fireEvent.change(select, { target: { value: 'CONTACTED' } });

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/admin/demo-requests/dr_1', {
        status: 'CONTACTED',
      });
    });
    expect(await screen.findByLabelText('Statut de Le Bistrot du Coin')).toHaveValue('CONTACTED');
  });

  it('propose de réessayer quand le chargement échoue', async () => {
    api.get
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ data: [notifiedRequest] });

    render(<DemoRequestsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Impossible de charger les demandes',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));

    expect(await screen.findByText('Le Bistrot du Coin')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('affiche un état vide quand aucune demande ne correspond au filtre', async () => {
    api.get.mockResolvedValue({ data: [] });

    render(<DemoRequestsPage />);

    expect(await screen.findByText('Aucune demande pour ce filtre.')).toBeInTheDocument();
  });
});
