import type { DayHours, Slot } from './hours';

export type StepProps = {
  onComplete: (nextStep: OnboardingTaskKey | null) => void;
  onNavigate?: (step: OnboardingTaskKey) => void;
};

export type OnboardingStatus = 'completed' | 'current' | 'blocked' | 'skipped' | 'pending';

export type OnboardingTaskKey =
  | 'restaurant'
  | 'hours'
  | 'floor'
  | 'knowledge'
  | 'phone'
  | 'channels'
  | 'connect-identity'
  | 'connect-location'
  | 'connect-cuisine'
  | 'connect-activation';

export type OnboardingTaskState = {
  status: OnboardingStatus;
  completedAt?: string;
  skippedAt?: string;
  blockedAt?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type OnboardingStep = {
  key: OnboardingTaskKey;
  title: string;
  description: string;
  required: boolean;
  group: 'voice' | 'connect';
  index: number;
  status: OnboardingStatus;
  state: OnboardingTaskState;
};

export type OnboardingRestaurant = {
  id: string;
  name: string;
  managerPhone: string;
  managerEmail: string;
  phoneE164?: string | null;
  googlePlaceId?: string | null;
  phoneNumber: string;
  phoneAssigned: boolean;
  openingHours: Record<string, DayHours>;
  googleCalendarId: string | null;
  googleConnected: boolean;
  personality?: {
    id?: string;
    profileType?: string;
    fillerStyle?: string;
    speakingRate?: string | number;
    volume?: string | number;
    systemPromptExtra?: string | null;
    voiceIdCa?: string | null;
    pronunciationDictId?: string | null;
    emotion?: string | null;
  } | null;
  practicalInfo?: PracticalInfo;
  // Sokar Connect fields
  slug?: string;
  description?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  lat?: number | null;
  lng?: number | null;
  cuisineType?: string[];
  priceRange?: number | null;
  ambiance?: string[];
  dietary?: string[];
  coverImageUrl?: string | null;
  images?: Array<{ url: string; isCover: boolean; position: number; alt?: string | null }>;
  exposureSettings?: {
    connectPublished: boolean;
    connectAgentic: boolean;
    holdTtlSeconds?: number;
    cancellationWindowMinutes?: number;
    noShowFeeCents?: number;
    depositRequired?: boolean;
    requiresDepositAbove?: number | null;
    maxPartySize?: number;
    capacitySpecials?: Record<string, unknown> | null;
  } | null;
};

export type OpeningHourPeriod = Slot;
export type OpeningHoursDay = Exclude<DayHours, null>;

/** Faits pratiques du restaurant ; une clé absente signifie « non précisé », jamais « non ». */
export type PracticalInfo = {
  terrace?: boolean;
  privatization?: boolean;
  parking?: 'onsite' | 'nearby' | 'none';
  accessible?: boolean;
  pets?: 'yes' | 'terrace' | 'no';
  kidsMenu?: boolean;
  menuUrl?: string;
  notes?: string;
};

export type ReservationReadiness = {
  ready: boolean;
  checks: Array<{ key: 'hours' | 'tables' | 'rules'; label: string; ok: boolean }>;
  tableCount: number;
  seatCount: number;
  largestTableCapacity: number;
};

export type OnboardingState = {
  /** Ce qu'il manque pour que les clients puissent réserver, quel que soit le canal. */
  readiness?: ReservationReadiness;
  onboardingDone: boolean; // Voice onboarding done
  voiceOnboardingDone: boolean;
  connectOnboardingDone: boolean;
  minimumViableDone: boolean; // restaurant + hours completed
  onboardingCompletedAt: string | null;
  onboardingActivatedAt: string | null;
  onboardingLastSeenAt: string | null;
  firstCallAt: string | null;
  currentStep: OnboardingStep;
  completedCount: number;
  totalCount: number;
  progress: number;
  voiceProgress: number;
  connectProgress: number;
  steps: OnboardingStep[];
  defaultHours: Record<string, { open: string; close: string }>;
  restaurant: OnboardingRestaurant;
};

export type OnboardingAction =
  | 'seen'
  | 'start'
  | 'complete'
  | 'skip'
  | 'block'
  | 'activate'
  | 'first_call';

// `floor` couvre les tables et les règles de réservation, communes à tous les canaux.
export const ONBOARDING_TASK_KEYS: OnboardingTaskKey[] = [
  'restaurant',
  'hours',
  'floor',
  'knowledge',
  'phone',
  'connect-identity',
  'connect-activation',
];

/** Les anciennes tâches restent acceptées par l’API et rejoignent l’éditeur Connect. */
export function resolveOnboardingTask(key: string | null): OnboardingTaskKey | undefined {
  if (key === 'channels' || key === 'connect-location' || key === 'connect-cuisine')
    return 'connect-identity';
  return ONBOARDING_TASK_KEYS.find((task) => task === key);
}

/** Projection du parcours actuel, sans retirer les clés historiques du contrat API. */
export function getVisibleOnboardingState(state: OnboardingState): OnboardingState {
  const steps = state.steps.filter((step) => ONBOARDING_TASK_KEYS.includes(step.key));
  const voice = steps.filter((step) => step.group === 'voice');
  const connect = steps.filter((step) => step.group === 'connect');
  const completed = steps.filter((step) => step.status === 'completed').length;
  const voiceCompleted = voice.filter((step) => step.status === 'completed').length;
  const connectCompleted = connect.filter((step) => step.status === 'completed').length;
  const voiceDone = voice.length > 0 && voiceCompleted === voice.length;
  const currentStep = !ONBOARDING_TASK_KEYS.includes(state.currentStep.key)
    ? (steps.find((step) => step.status === 'current') ??
      steps.find((step) => step.status !== 'completed') ??
      steps[steps.length - 1] ??
      state.currentStep)
    : state.currentStep;
  return {
    ...state,
    steps,
    currentStep,
    completedCount: completed,
    totalCount: steps.length,
    progress: steps.length ? Math.round((completed / steps.length) * 100) : 0,
    onboardingDone: voiceDone,
    voiceOnboardingDone: voiceDone,
    voiceProgress: voice.length ? Math.round((voiceCompleted / voice.length) * 100) : 0,
    connectOnboardingDone: connect.length > 0 && connectCompleted === connect.length,
    connectProgress: connect.length ? Math.round((connectCompleted / connect.length) * 100) : 0,
  };
}
