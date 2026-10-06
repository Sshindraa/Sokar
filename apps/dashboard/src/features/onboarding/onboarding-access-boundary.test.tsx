import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OnboardingAccessBoundary } from './onboarding-access-boundary';
import { ONBOARDING_TASK_KEYS, type OnboardingState, type OnboardingStatus } from './types';

const mocks = vi.hoisted(() => ({
  state: null as OnboardingState | null,
  loading: false,
  refresh: vi.fn(),
  pathname: '/dashboard',
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('./onboarding-provider', () => ({ useOnboarding: () => mocks }));

function stateWith(status: OnboardingStatus): OnboardingState {
  return {
    voiceOnboardingDone: true,
    connectOnboardingDone: true,
    steps: ONBOARDING_TASK_KEYS.map((key) => ({ key, status })),
  } as OnboardingState;
}
function mount(enforceAccess = true) {
  return render(
    <OnboardingAccessBoundary
      enforceAccess={enforceAccess}
      onboarding={<p>Parcours de configuration</p>}
    >
      <p>Réservations accessibles</p>
    </OnboardingAccessBoundary>,
  );
}
beforeEach(() => {
  mocks.state = stateWith('pending');
  mocks.loading = false;
  mocks.pathname = '/dashboard';
  vi.clearAllMocks();
});
it('ne monte pas les fonctionnalités même si les indicateurs globaux annoncent une complétion', () => {
  mount();
  expect(screen.queryByText('Réservations accessibles')).not.toBeInTheDocument();
  expect(screen.getByText('Parcours de configuration')).toBeInTheDocument();
});
it.each(['skipped', 'blocked', 'current'] as const)('refuse une étape %s', (status) => {
  mocks.state = stateWith('completed');
  mocks.state.steps[4].status = status;
  mount();
  expect(screen.queryByText('Réservations accessibles')).not.toBeInTheDocument();
});
it('refuse une étape absente', () => {
  mocks.state = stateWith('completed');
  mocks.state.steps.pop();
  mount();
  expect(screen.queryByText('Réservations accessibles')).not.toBeInTheDocument();
});
it('laisse accéder au dashboard de prévisualisation sans vérifier un onboarding inexistant', () => {
  mount(false);
  expect(screen.getByText('Réservations accessibles')).toBeInTheDocument();
  expect(screen.queryByText('Parcours de configuration')).not.toBeInTheDocument();
  expect(mocks.replace).not.toHaveBeenCalled();
});
it('déverrouille immédiatement quand les dix étapes sont terminées', () => {
  const view = mount();
  mocks.state = stateWith('completed');
  view.rerender(
    <OnboardingAccessBoundary onboarding={<p>Parcours de configuration</p>}>
      <p>Réservations accessibles</p>
    </OnboardingAccessBoundary>,
  );
  expect(screen.getByText('Réservations accessibles')).toBeInTheDocument();
  expect(screen.queryByText('Parcours de configuration')).not.toBeInTheDocument();
});
it('attend la vérification même avec un ancien état complet', () => {
  mocks.state = stateWith('completed');
  mocks.loading = true;
  mount();
  expect(screen.getByRole('status')).toBeInTheDocument();
  expect(screen.queryByText('Réservations accessibles')).not.toBeInTheDocument();
});
it('reste fermé et propose une nouvelle tentative si l’état est indisponible', () => {
  mocks.state = null;
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(mocks.refresh).toHaveBeenCalled();
  expect(screen.queryByText('Réservations accessibles')).not.toBeInTheDocument();
});

it('redirige un dashboard incomplet vers la route onboarding', async () => {
  mocks.pathname = '/dashboard/reservations';
  mount();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/onboarding'));
});
it('retourne au dashboard une fois toutes les étapes validées', async () => {
  mocks.state = stateWith('completed');
  mocks.pathname = '/onboarding';
  mount();
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/dashboard'));
});
