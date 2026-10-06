import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ConnectCapacityStep } from './ConnectCapacityStep';

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  updateTask: vi.fn(),
  restaurant: {
    id: 'local-test',
    exposureSettings: {
      capacitySpecials: { totalCapacity: -1 },
    },
  },
}));

vi.mock('@/lib/api', () => ({ useApi: () => ({ ...mocks, orgId: 'local-test' }) }));
vi.mock('../onboarding-provider', () => ({
  useOnboarding: () => ({ state: { restaurant: mocks.restaurant }, ...mocks }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.restaurant.exposureSettings.capacitySpecials.totalCapacity = -1;
  mocks.patch.mockResolvedValue({});
  mocks.updateTask.mockResolvedValue({});
});

it('ouvre directement le formulaire et bloque la suite avec une capacité invalide', () => {
  const complete = vi.fn();
  render(<ConnectCapacityStep onComplete={complete} />);

  expect(screen.getByLabelText('Capacité totale')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retour au résumé' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Compléter les règles de réservation' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Complétez les règles de réservation');
  expect(mocks.patch).not.toHaveBeenCalled();
  expect(complete).not.toHaveBeenCalled();
});

it('enregistre et avance avec les valeurs proposées valides', async () => {
  mocks.restaurant.exposureSettings.capacitySpecials.totalCapacity = 40;
  const complete = vi.fn();
  render(<ConnectCapacityStep onComplete={complete} />);

  fireEvent.click(
    screen.getByRole('button', { name: 'Continuer vers la vérification de la page' }),
  );

  await waitFor(() => expect(complete).toHaveBeenCalledWith('connect-activation'));
});
