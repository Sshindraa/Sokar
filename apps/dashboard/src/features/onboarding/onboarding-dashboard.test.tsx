import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { OnboardingState, OnboardingStep } from './types';
import { DashboardOnboardingPanel } from './onboarding-dashboard';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  openStepModal: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock('./onboarding-provider', () => ({
  useOnboarding: () => ({
    state: mocks.state as OnboardingState | null,
    loading: false,
    error: '',
    openStepModal: mocks.openStepModal,
    updateTask: mocks.updateTask,
  }),
}));

function createPreviewState(): OnboardingState {
  const steps: OnboardingStep[] = [
    {
      key: 'restaurant',
      title: 'Identité du restaurant',
      description: 'Informations du restaurant.',
      required: true,
      group: 'voice',
      index: 1,
      status: 'completed',
      state: { status: 'completed' },
    },
    {
      key: 'connect-identity',
      title: 'Identité publique',
      description: 'Page publique.',
      required: false,
      group: 'connect',
      index: 1,
      status: 'pending',
      state: { status: 'pending' },
    },
  ];

  return {
    onboardingDone: false,
    voiceOnboardingDone: false,
    connectOnboardingDone: false,
    minimumViableDone: false,
    onboardingCompletedAt: null,
    onboardingActivatedAt: null,
    onboardingLastSeenAt: null,
    firstCallAt: null,
    currentStep: steps[1],
    completedCount: 1,
    totalCount: 10,
    progress: 10,
    voiceProgress: 20,
    connectProgress: 0,
    steps,
    defaultHours: {},
    restaurant: {
      id: 'preview',
      name: 'Chez Sokar',
      managerPhone: '',
      managerEmail: '',
      phoneNumber: '',
      phoneAssigned: false,
      openingHours: {},
      googleCalendarId: null,
      googleConnected: false,
      personality: null,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state = createPreviewState();
});

it('reprend le parcours Connect recommandé sans imposer les appels', () => {
  render(<DashboardOnboardingPanel />);
  expect(screen.getByText('Préparez votre page de réservation')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Remplir l’identité publique' }));
  expect(mocks.openStepModal).toHaveBeenCalledWith('connect-identity');
  expect(screen.queryByText('Action recommandée')).not.toBeInTheDocument();
});

it('permet de choisir le parcours vocal et de rouvrir une étape terminée', () => {
  render(<DashboardOnboardingPanel />);
  fireEvent.click(screen.getByRole('button', { name: /^Assistant vocal$/ }));
  expect(screen.getByText('Préparez votre assistant vocal')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Restaurant — Terminé' }));
  expect(mocks.openStepModal).toHaveBeenCalledWith('restaurant');
});

it('privilégie une étape réalisable et garde le planning accessible', () => {
  const state = createPreviewState();
  const calendar: OnboardingStep = {
    ...state.steps[0],
    key: 'calendar',
    title: 'Planning',
    status: 'blocked',
    state: { status: 'blocked', reason: 'Clerk/API OAuth' },
  };
  const hours: OnboardingStep = {
    ...calendar,
    key: 'hours',
    title: 'Horaires',
    status: 'pending',
    state: { status: 'pending' },
  };
  mocks.state = { ...state, currentStep: calendar, steps: [...state.steps, calendar, hours] };
  render(<DashboardOnboardingPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Configurer les horaires' }));
  expect(mocks.openStepModal).toHaveBeenCalledWith('hours');
  expect(screen.getByRole('button', { name: 'Planning — À résoudre' })).toBeInTheDocument();
  expect(screen.queryByText(/Réessayer Google/)).not.toBeInTheDocument();
});

it('explique une dépendance Sokar sans exposer le diagnostic technique', () => {
  const state = createPreviewState();
  const calendar: OnboardingStep = {
    ...state.steps[0],
    key: 'calendar',
    title: 'Planning',
    status: 'blocked',
    state: { status: 'blocked', reason: 'Clerk/API OAuth' },
  };
  mocks.state = { ...state, currentStep: calendar, steps: [calendar] };
  render(<DashboardOnboardingPanel />);
  expect(screen.getByText('Une configuration côté Sokar est nécessaire')).toBeInTheDocument();
  expect(screen.queryByText(/Clerk/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Voir les options' }));
  expect(mocks.openStepModal).toHaveBeenCalledWith('calendar');
});

it('invite à vérifier les appels une fois la configuration terminée', () => {
  mocks.state = { ...createPreviewState(), voiceOnboardingDone: true, connectOnboardingDone: true };
  render(<DashboardOnboardingPanel />);
  fireEvent.click(screen.getByRole('button', { name: /^Assistant vocal$/ }));
  expect(screen.getByText('Vérifiez le résultat avec un appel test')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Vérifier les appels' }));
  expect(mocks.openStepModal).toHaveBeenCalledWith('phone');
});
