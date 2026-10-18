import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectCuisineStep } from './ConnectCuisineStep';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  updateTask: vi.fn(),
  restaurant: {
    id: 'local-test',
    cuisineType: [] as string[],
    priceRange: 2,
    dietary: [] as string[],
    ambiance: [] as string[],
  },
}));

vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'local-test' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({ state: { restaurant: mocks.restaurant }, ...mocks }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.restaurant.cuisineType = [];
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
});

it('ouvre directement le formulaire et bloque la suite sans cuisine renseignée', () => {
  const complete = vi.fn();
  render(<ConnectCuisineStep onComplete={complete} />);

  expect(screen.getByRole('button', { name: 'Italien' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retour au résumé' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Ajouter un type de cuisine' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choisissez au moins un type de cuisine');
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('enregistre et avance après le choix d’une cuisine', async () => {
  const complete = vi.fn();
  render(<ConnectCuisineStep onComplete={complete} />);

  fireEvent.click(screen.getByRole('button', { name: 'Italien' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continuer vers les règles de réservation' }));

  await waitFor(() => expect(complete).toHaveBeenCalledWith('connect-activation'));
});
