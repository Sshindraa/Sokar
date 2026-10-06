import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectIdentityStep } from './ConnectIdentityStep';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
  updateTask: vi.fn(),
  setIdentityDraft: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'local-test' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    state: { restaurant: { id: 'local-test', name: 'Chez Émile' } },
    identityDraft: null,
    ...mocks,
  }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue({ available: true });
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
});
it('présente une fiche prête sans outils d’édition et permet de continuer immédiatement', async () => {
  const complete = vi.fn();
  render(<ConnectIdentityStep onComplete={complete} />);
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByText(/10 Mo maximum/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuer vers l’adresse' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Continuer vers l’adresse' }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith('connect-location'));
  expect(mocks.patch).toHaveBeenCalledWith(
    'restaurants/local-test/connect',
    expect.objectContaining({
      description: 'Découvrez Chez Émile.',
      coverImageUrl: '',
    }),
  );
  expect(mocks.post).not.toHaveBeenCalled();
});
it('remplace une présentation effacée par la proposition sans bloquer', async () => {
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Modifier les informations' }));
  fireEvent.click(screen.getByRole('button', { name: 'Modifier la présentation' }));
  fireEvent.change(screen.getByLabelText('Comment souhaitez-vous être présenté ?'), {
    target: { value: '' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continuer vers l’adresse' }));
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith(
      'restaurants/local-test/connect',
      expect.objectContaining({
        description: 'Découvrez Chez Émile.',
      }),
    ),
  );
});
it('ne sauvegarde pas une adresse déjà utilisée', async () => {
  mocks.get.mockResolvedValue({ available: false });
  const complete = vi.fn();
  render(<ConnectIdentityStep onComplete={complete} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continuer vers l’adresse' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Cette adresse est déjà utilisée');
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});
it('conserve la saisie si la sauvegarde échoue', async () => {
  mocks.patch.mockRejectedValue(new Error('offline'));
  render(<ConnectIdentityStep onComplete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Continuer vers l’adresse' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Votre saisie est conservée');
});
