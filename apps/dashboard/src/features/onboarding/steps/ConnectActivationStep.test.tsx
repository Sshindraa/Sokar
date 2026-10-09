import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectActivationStep } from './ConnectActivationStep';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), updateTask: vi.fn(), ready: false }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'local-test' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    updateTask: mocks.updateTask,
    placeImportDraft: null,
    state: {
      steps: [{ key: 'connect-identity', status: mocks.ready ? 'completed' : 'pending' }],
      restaurant: {
        name: 'Chez Émile',
        slug: mocks.ready ? 'chez-emile' : '',
        exposureSettings: {},
      },
    },
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = false;
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
});
it('ramène à l’éditeur si la page n’a pas été enregistrée', () => {
  const navigate = vi.fn();
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={navigate} />);
  expect(screen.queryByTitle('Aperçu de votre page publique')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Compléter ma page' }));
  expect(navigate).toHaveBeenCalledWith('connect-identity');
  expect(mocks.patch).not.toHaveBeenCalled();
});
it('publie uniquement lors de la confirmation finale', async () => {
  mocks.ready = true;
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(screen.getByTitle('Aperçu de votre page publique')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publier ma page' }));
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith('restaurants/local-test/connect', {
      connectPublished: true,
      connectAgentic: false,
    }),
  );
  expect(mocks.updateTask).toHaveBeenCalledWith('complete', 'connect-activation');
});
