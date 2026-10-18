import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectActivationStep } from './ConnectActivationStep';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  updateTask: vi.fn(),
  ready: false,
  published: false,
  agentic: false,
  calls: [] as string[],
}));
vi.mock('@/lib/api', () => ({
  useApi: () => ({
    get: mocks.get,
    put: mocks.put,
    post: mocks.post,
    patch: mocks.patch,
    orgId: 'local-test',
  }),
}));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({
    updateTask: mocks.updateTask,
    placeImportDraft: null,
    state: {
      steps: [{ key: 'connect-identity', status: mocks.ready ? 'completed' : 'pending' }],
      restaurant: {
        name: 'Chez Émile',
        slug: mocks.ready ? 'chez-emile' : '',
        exposureSettings: { connectPublished: mocks.published, connectAgentic: mocks.agentic },
      },
    },
  }),
}));

const SETTINGS = { maxPartySize: 8, minLeadTimeMinutes: 30, requireManualValidation: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.ready = false;
  mocks.published = false;
  mocks.agentic = false;
  mocks.calls = [];
  mocks.get.mockImplementation(async (path: string) =>
    path === 'api/agentic/opt-in' ? { mcp: false, openaiReserve: false } : SETTINGS,
  );
  mocks.put.mockImplementation(async (path: string) => {
    mocks.calls.push(path);
    return {};
  });
  mocks.post.mockImplementation(async (path: string, body: { mcp: boolean }) => {
    mocks.calls.push(path);
    return { mcp: body.mcp, openaiReserve: false };
  });
  mocks.patch.mockImplementation(async (path: string) => {
    mocks.calls.push(path);
    return {};
  });
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

it('publie puis montre la diffusion sans clore l’étape', async () => {
  mocks.ready = true;
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  expect(screen.getByTitle('Aperçu de votre page publique')).toBeInTheDocument();
  expect(await screen.findByText('8 personnes')).toBeInTheDocument();
  expect(mocks.patch).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Publier ma page' }));
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith('restaurants/local-test/connect', {
      connectPublished: true,
      connectAgentic: false,
    }),
  );
  expect(
    await screen.findByText('Votre page est en ligne. Partagez-la dès maintenant.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Réserver sur ma page/ })).toHaveAttribute(
    'href',
    expect.stringMatching(/\/restaurant\/chez-emile\?testBooking=1$/),
  );
  expect(screen.getByText(/data-slug="chez-emile"/)).toBeInTheDocument();
  // Sans conditions modifiées ni IA activée, rien d'autre n'est écrit.
  expect(mocks.put).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.updateTask).not.toHaveBeenCalled();
});

it('clôt l’étape à « Continuer » une fois la page en ligne, sans republier', async () => {
  mocks.ready = true;
  mocks.published = true;
  const complete = vi.fn();
  render(<ConnectActivationStep onComplete={complete} onNavigate={vi.fn()} />);
  await screen.findByText('8 personnes');
  fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  await waitFor(() => expect(complete).toHaveBeenCalledWith(null));
  expect(mocks.updateTask).toHaveBeenCalledWith('complete', 'connect-activation');
  expect(mocks.patch).not.toHaveBeenCalled();
});

it('enregistre les conditions en ligne modifiées', async () => {
  mocks.ready = true;
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  await screen.findByText('8 personnes');
  fireEvent.click(screen.getByRole('button', { name: '2 h' }));
  expect(screen.getByRole('button', { name: '2 h' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('switch', { name: 'Valider chaque réservation à la main' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publier ma page' }));
  await waitFor(() =>
    expect(mocks.put).toHaveBeenCalledWith('api/agentic/exposure-settings', {
      minLeadTimeMinutes: 120,
      requireManualValidation: true,
    }),
  );
});

it('active la réservation par les assistants IA avant de publier', async () => {
  mocks.ready = true;
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  await screen.findByText('8 personnes');
  fireEvent.click(screen.getByRole('switch', { name: 'Réservable depuis les assistants IA' }));
  fireEvent.click(screen.getByRole('button', { name: 'Publier ma page' }));
  await waitFor(() =>
    expect(mocks.patch).toHaveBeenCalledWith('restaurants/local-test/connect', {
      connectPublished: true,
      connectAgentic: true,
    }),
  );
  expect(mocks.post).toHaveBeenCalledWith('api/agentic/opt-in', {
    mcp: true,
    openaiReserve: false,
  });
  expect(mocks.calls).toEqual(['api/agentic/opt-in', 'restaurants/local-test/connect']);
});

it('reprend l’ancienne découverte IA comme réservation IA activée', async () => {
  mocks.ready = true;
  mocks.agentic = true;
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  await screen.findByText('8 personnes');
  expect(
    screen.getByRole('switch', { name: 'Réservable depuis les assistants IA' }),
  ).toHaveAttribute('aria-checked', 'true');
});

it('publie même si les conditions ne peuvent pas être chargées', async () => {
  mocks.ready = true;
  mocks.get.mockRejectedValue(new Error('indisponible'));
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  expect(await screen.findByText(/n’ont pas pu être chargées/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Publier ma page' }));
  await waitFor(() => expect(mocks.patch).toHaveBeenCalled());
  expect(mocks.put).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});

it('adapte le guide d’installation à l’outil du site', async () => {
  mocks.ready = true;
  mocks.published = true;
  render(<ConnectActivationStep onComplete={vi.fn()} onNavigate={vi.fn()} />);
  expect(screen.getByText(/bloc « HTML personnalisé »/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Wix' }));
  expect(screen.getByRole('button', { name: 'Wix' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/Intégrer du code › Intégrer HTML/)).toBeInTheDocument();
  await screen.findByText('8 personnes');
});
