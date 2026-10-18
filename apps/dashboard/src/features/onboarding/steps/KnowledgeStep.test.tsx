import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { KnowledgeStep } from './KnowledgeStep';

const mocks = vi.hoisted(() => ({ patch: vi.fn(), updateTask: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ useApi: () => ({ patch: mocks.patch, orgId: 'restaurant-1' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({ state: { restaurant: {} }, updateTask: mocks.updateTask }),
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
  mocks.fetch.mockResolvedValue({
    ok: true,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => ({ transcript: 'Bonsoir, bienvenue.', fallback: true }),
  });
  vi.stubGlobal('fetch', mocks.fetch);
});
it('enregistre avant la démo, invalide après ajustement et complète seulement à la validation', async () => {
  const complete = vi.fn();
  render(<KnowledgeStep onComplete={complete} />);
  const next = screen.getByRole('button', { name: 'Continuer' });
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Calme' }));
  fireEvent.click(screen.getByRole('button', { name: 'Écouter Sokar' }));
  await waitFor(() => expect(next).toBeEnabled());
  expect(mocks.patch).toHaveBeenCalledWith(
    'restaurants/restaurant-1/personality',
    expect.objectContaining({ speakingRate: 0.85 }),
  );
  expect(mocks.patch.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.fetch.mock.invocationCallOrder[0],
  );
  expect(mocks.updateTask).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Plus chaleureux' }));
  expect(next).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Écouter Sokar' }));
  await waitFor(() => expect(next).toBeEnabled());
  fireEvent.click(next);
  await waitFor(() => expect(complete).toHaveBeenCalledWith('phone'));
  expect(mocks.updateTask).toHaveBeenCalledWith('complete', 'knowledge');
});
it('affiche une erreur et ne génère pas la démo si la sauvegarde échoue', async () => {
  mocks.patch.mockRejectedValue(new Error('Enregistrement indisponible'));
  render(<KnowledgeStep onComplete={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Écouter Sokar' }));
  await screen.findByText('Enregistrement indisponible');
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Continuer' })).toBeDisabled();
});

it('explique pourquoi « Continuer » est grisé, puis propose un ajustement après l’écoute', async () => {
  render(<KnowledgeStep onComplete={vi.fn()} />);
  expect(screen.getByText(/Écoutez la démonstration/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Écouter Sokar' }));
  await screen.findByText('Un ajustement ?');
  expect(screen.queryByText(/Écoutez la démonstration/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Parfait' })).not.toBeInTheDocument();
});
