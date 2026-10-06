import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
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
    'knowledge',
    'calendar',
    'phone',
    'connect-identity',
    'connect-location',
    'connect-cuisine',
    'connect-capacity',
    'connect-activation',
  ];
  const steps = keys.map((key, index) => {
    const status = key === 'restaurant' || key === 'hours' ? 'completed' : 'pending';
    return {
      key,
      title: key,
      description: '',
      required: false,
      group: key.startsWith('connect-') ? 'connect' : 'voice',
      index: key.startsWith('connect-') ? index - 4 : index + 1,
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
    voiceProgress: 40,
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
  vi.clearAllMocks();
  mocks.state = createState();
});

it('garde le point actif quand l’étape courante est déjà marquée terminée', () => {
  render(<OnboardingWizard />);
  const hours = screen.getByRole('button', { name: 'Vos horaires' });
  fireEvent.click(hours);

  expect(hours).toHaveAttribute('aria-current', 'step');
  expect(hours.querySelector('svg')).toHaveClass('fill-primary');
  expect(hours.querySelector('svg')).not.toHaveClass('text-success');
  expect(
    screen.getByText(
      'Choisissez les jours et les plages horaires où votre restaurant accepte les réservations. Sokar propose des créneaux toutes les 30 minutes.',
    ),
  ).toBeInTheDocument();
});
