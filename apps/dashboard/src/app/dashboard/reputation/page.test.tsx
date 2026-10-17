import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toApiError } from '@/lib/api-error';
import ReputationPage from './page';

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  useApi: () => ({ get: apiMocks.get, patch: apiMocks.patch }),
}));

const feedback = {
  id: 'feedback-1',
  requestId: 'request-1',
  reservationId: 'reservation-1',
  score: 2,
  comment: 'Service trop long',
  submittedAt: '2026-09-14T10:00:00.000Z',
};

const task = {
  id: 'task-1',
  feedbackId: 'feedback-1',
  reservationId: 'reservation-1',
  status: 'OPEN',
  priority: 'NORMAL',
  assigned: false,
  resolutionCode: null,
  resolutionNote: null,
  resolvedAt: null,
  score: 2,
  comment: 'Service trop long',
  createdAt: '2026-09-14T10:00:00.000Z',
  updatedAt: '2026-09-14T10:00:00.000Z',
};

// Le bouton n’apparaît qu’une fois les tâches chargées, et reste désactivé pendant une action :
// on attend qu’il soit actif, sinon React ignore le clic.
async function clickWhenEnabled(name: string | RegExp) {
  await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('ReputationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('reputation/feedback?')) return Promise.resolve({ data: [feedback] });
      if (path.includes('status=IN_PROGRESS')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [task] });
    });
    apiMocks.patch.mockResolvedValue({
      data: { ...task, status: 'IN_PROGRESS', assigned: true },
    });
  });

  it('affiche le score et la boîte de récupération', async () => {
    render(<ReputationPage />);

    expect(await screen.findByRole('heading', { name: 'Réputation' })).toBeInTheDocument();
    expect(await screen.findByText('2.0/5')).toBeInTheDocument();
    expect(await screen.findAllByText('Service trop long')).toHaveLength(2);
    expect(await screen.findByText('À traiter')).toBeInTheDocument();
    expect(await screen.findByText('1 active(s)')).toBeInTheDocument();
  });

  it('met une récupération en cours avec une mutation tenant-scoped', async () => {
    render(<ReputationPage />);
    await screen.findByRole('heading', { name: 'Réputation' });

    await clickWhenEnabled('Prendre en charge');
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('reputation/recovery-tasks/task-1', {
        status: 'IN_PROGRESS',
      }),
    );
  });

  it('explique calmement que le module est fermé, sans « Réessayer » ni compteurs à zéro', async () => {
    apiMocks.get.mockRejectedValue(toApiError(503, { error: 'REPUTATION_DISABLED' }));
    render(<ReputationPage />);

    expect(
      await screen.findByText('Cette fonctionnalité n’est pas encore ouverte sur votre compte.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('REPUTATION_DISABLED')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(screen.queryByText('Aucune récupération à traiter')).toBeNull();
    expect(screen.queryByText('Retours reçus')).toBeNull();
  });

  it('propose les formules quand le module n’est pas inclus', async () => {
    apiMocks.get.mockRejectedValue(toApiError(403, { error: 'CAPABILITY_NOT_INCLUDED' }));
    render(<ReputationPage />);

    expect(await screen.findByRole('link', { name: 'Voir les formules' })).toBeInTheDocument();
  });

  it('n’affiche ni « 0 retour » ni « rien à traiter » après une panne, et propose de réessayer', async () => {
    apiMocks.get.mockRejectedValueOnce(toApiError(503, {}));
    apiMocks.get.mockResolvedValue({ data: [] });
    render(<ReputationPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('momentanément indisponible');
    expect(screen.queryByText('Aucune récupération à traiter')).toBeNull();
    expect(screen.queryByText('Retours reçus')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /réessayer/i }));
    expect(await screen.findByText('Retours reçus')).toBeInTheDocument();
  });

  it('charge séparément les demandes à traiter et en cours, pour ne rien perdre au-delà de 100', async () => {
    render(<ReputationPage />);
    await screen.findByRole('heading', { name: 'Réputation' });

    expect(apiMocks.get).toHaveBeenCalledWith('reputation/recovery-tasks?status=OPEN&limit=100');
    expect(apiMocks.get).toHaveBeenCalledWith(
      'reputation/recovery-tasks?status=IN_PROGRESS&limit=100',
    );
  });

  it('ne montre aucun identifiant technique de réservation', async () => {
    render(<ReputationPage />);
    await screen.findByText('Service trop long', { selector: 'p' });

    expect(screen.queryByText(/reservation-1/)).toBeNull();
  });

  it('dit qu’un collègue a déjà traité la demande et actualise la liste', async () => {
    apiMocks.patch.mockRejectedValue(
      toApiError(409, { error: 'REPUTATION_RECOVERY_TRANSITION_INVALID' }),
    );
    render(<ReputationPage />);
    await screen.findByRole('heading', { name: 'Réputation' });

    await clickWhenEnabled('Prendre en charge');

    expect(
      await screen.findByText(
        'Cette demande a déjà été traitée par un collègue. La liste est actualisée.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/REPUTATION_RECOVERY/)).toBeNull();
  });
});
