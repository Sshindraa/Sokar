import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('ReputationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.get.mockImplementation((path: string) => {
      if (path.startsWith('reputation/feedback?')) return Promise.resolve({ data: [feedback] });
      return Promise.resolve({ data: [task] });
    });
    apiMocks.patch.mockResolvedValue({
      data: { ...task, status: 'IN_PROGRESS', assigned: true },
    });
  });

  it('affiche le score et la boîte de récupération', async () => {
    render(<ReputationPage />);

    expect(await screen.findByRole('heading', { name: 'Réputation' })).toBeInTheDocument();
    expect(screen.getByText('2.0/5')).toBeInTheDocument();
    expect(screen.getAllByText('Service trop long')).toHaveLength(2);
    expect(screen.getByText('À traiter')).toBeInTheDocument();
    expect(screen.getByText('1 active(s)')).toBeInTheDocument();
  });

  it('met une récupération en cours avec une mutation tenant-scoped', async () => {
    render(<ReputationPage />);
    await screen.findByRole('heading', { name: 'Réputation' });

    fireEvent.click(screen.getByRole('button', { name: 'Prendre en charge' }));
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('reputation/recovery-tasks/task-1', {
        status: 'IN_PROGRESS',
      }),
    );
  });

  it('explique quand la fondation est verrouillée', async () => {
    apiMocks.get.mockRejectedValue(new Error('REPUTATION_DISABLED'));
    render(<ReputationPage />);

    expect(await screen.findByText('REPUTATION_DISABLED')).toBeInTheDocument();
    expect(screen.getByText(/reste verrouillée tant que le pilote d’envoi/)).toBeInTheDocument();
  });
});
