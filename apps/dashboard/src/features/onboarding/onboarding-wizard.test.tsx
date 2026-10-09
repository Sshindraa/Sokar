import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getVisibleOnboardingState, ONBOARDING_TASK_KEYS } from './types';
import type { OnboardingState, OnboardingStep, OnboardingTaskKey } from './types';
import { OnboardingWizard } from './onboarding-wizard';

const mocks = vi.hoisted(() => ({
  state: null as OnboardingState | null,
  updateTask: vi.fn(),
  Step: () => null,
}));

vi.mock('./onboarding-provider', () => ({
  useOnboarding: () => ({ state: mocks.state, error: '', updateTask: mocks.updateTask }),
}));

vi.mock('./steps', () => ({
  STEP_COMPONENTS: new Proxy({}, { get: () => mocks.Step }),
}));

function createState(): OnboardingState {
  const keys: OnboardingTaskKey[] = [
    'restaurant',
    'hours',
    'floor',
    'knowledge',
    'phone',
    'channels',
    'connect-identity',
    'connect-location',
    'connect-cuisine',
    'connect-activation',
  ];
  const steps = keys.map((key, index) => {
    const status = key === 'restaurant' || key === 'hours' ? 'completed' : 'pending';
    return {
      key,
      title: key,
      description: '',
      required: false,
      group: index < 6 ? 'voice' : 'connect',
      index: index < 6 ? index + 1 : index - 5,
      status,
      state: { status },
    } as OnboardingStep;
  });

  return {
    onboardingDone: false,
    voiceOnboardingDone: false,
    connectOnboardingDone: false,
    minimumViableDone: false,
    onboardingCompletedAt: null,
    onboardingActivatedAt: null,
    onboardingLastSeenAt: null,
    firstCallAt: null,
    currentStep: steps[2],
    completedCount: 2,
    totalCount: 10,
    progress: 20,
    voiceProgress: 33,
    connectProgress: 0,
    steps,
    defaultHours: {},
    restaurant: {
      id: 'restaurant-1',
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
  window.history.replaceState(null, '', '/onboarding');
  vi.clearAllMocks();
  mocks.state = createState();
});

afterEach(() => {
  window.history.replaceState(null, '', '/onboarding');
  vi.unstubAllEnvs();
});

it('ouvre un lien Connect en production sans démarrer une autre étape', () => {
  vi.stubEnv('NODE_ENV', 'production');
  window.history.replaceState(null, '', '/onboarding?step=connect-identity');
  render(<OnboardingWizard />);
  expect(screen.getByRole('button', { name: 'Votre page' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  expect(mocks.updateTask).toHaveBeenCalledWith('start', 'connect-identity');
  expect(mocks.updateTask).not.toHaveBeenCalledWith('start', 'floor');
});

it('accepte le lien historique channels dans le parcours Connect', () => {
  window.history.replaceState(null, '', '/onboarding?step=channels');
  render(<OnboardingWizard />);
  expect(screen.getByRole('button', { name: 'Votre page' })).toHaveAttribute(
    'aria-current',
    'step',
  );
});

it('ignore un paramètre d’étape inconnu et reprend le parcours', () => {
  window.history.replaceState(null, '', '/onboarding?step=unknown');
  render(<OnboardingWizard />);
  expect(screen.getByRole('button', { name: 'Salle et règles' })).toHaveAttribute(
    'aria-current',
    'step',
  );
});

it('garde le point actif quand l’étape courante est déjà marquée terminée', () => {
  render(<OnboardingWizard />);
  const hours = screen.getByRole('button', { name: 'Vos horaires' });
  fireEvent.click(hours);

  expect(hours).toHaveAttribute('aria-current', 'step');
  expect(screen.getByText('2 sur 5')).toBeInTheDocument();
  expect(
    screen.getByText('Choisissez la dernière arrivée acceptée pour chaque service.'),
  ).toBeInTheDocument();
});

it('termine le parcours vocal par les appels sans finalisation intermédiaire', () => {
  render(<OnboardingWizard />);
  fireEvent.click(screen.getByRole('button', { name: 'Appels' }));
  expect(screen.getByText('5 sur 5')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Finalisation' })).not.toBeInTheDocument();
  expect(ONBOARDING_TASK_KEYS[ONBOARDING_TASK_KEYS.indexOf('phone') + 1]).toBe('connect-identity');
});

it('ne bloque pas les anciens comptes sur la tâche channels', () => {
  const state = createState();
  state.steps = state.steps.map((step) => ({
    ...step,
    status: step.group === 'voice' && step.key !== 'channels' ? 'completed' : 'pending',
  }));
  state.currentStep = state.steps.find((step) => step.key === 'channels')!;
  const visible = getVisibleOnboardingState(state);
  expect(visible.steps).toHaveLength(7);
  expect(visible.totalCount).toBe(7);
  expect(visible.voiceOnboardingDone).toBe(true);
  expect(visible.voiceProgress).toBe(100);
  expect(visible.currentStep.key).toBe('connect-identity');
});

it('réserve la finalisation à la dernière étape de Sokar Connect', () => {
  mocks.state = getVisibleOnboardingState(createState());
  mocks.state.currentStep = mocks.state.steps.find((step) => step.key === 'connect-activation')!;
  mocks.state.steps = mocks.state.steps.map((step) => ({
    ...step,
    status: step.key === 'connect-activation' ? 'current' : 'completed',
  }));
  render(<OnboardingWizard />);
  expect(screen.getByRole('button', { name: 'Publication' })).toHaveAttribute(
    'aria-current',
    'step',
  );
  expect(screen.getByText('2 sur 2')).toBeInTheDocument();
});

it.each(['connect-location', 'connect-cuisine'])(
  'ouvre l’éditeur depuis l’ancien lien %s',
  (step) => {
    window.history.replaceState(null, '', `/onboarding?step=${step}`);
    render(<OnboardingWizard />);
    expect(screen.getByRole('button', { name: 'Votre page' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.queryByRole('button', { name: 'Votre adresse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cuisine et ambiance' })).not.toBeInTheDocument();
    expect(screen.getByText('1 sur 2')).toBeInTheDocument();
  },
);
it('termine Connect sans les anciennes tâches adresse et cuisine', () => {
  const state = createState();
  state.steps = state.steps.map((step) => ({
    ...step,
    status: ['connect-identity', 'connect-activation'].includes(step.key) ? 'completed' : 'pending',
  }));
  state.currentStep = state.steps.find((step) => step.key === 'connect-location')!;
  const visible = getVisibleOnboardingState(state);
  expect(visible.connectOnboardingDone).toBe(true);
  expect(visible.connectProgress).toBe(100);
  expect(visible.steps.map((step) => step.key)).not.toContain('connect-location');
});
