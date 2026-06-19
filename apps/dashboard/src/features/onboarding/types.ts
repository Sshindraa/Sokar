export type OnboardingStatus = 'completed' | 'current' | 'blocked' | 'skipped' | 'pending';

export type OnboardingTaskKey = 'restaurant' | 'hours' | 'knowledge' | 'calendar' | 'phone';

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
  index: number;
  status: OnboardingStatus;
  state: OnboardingTaskState;
};

export type OnboardingRestaurant = {
  id: string;
  name: string;
  managerPhone: string;
  managerEmail: string;
  phoneNumber: string;
  phoneAssigned: boolean;
  openingHours: Record<string, { open: string; close: string } | null>;
  googleCalendarId: string | null;
  googleConnected: boolean;
  personality?: {
    id?: string;
    profileType?: string;
    fillerStyle?: string;
    speakingRate?: string | number;
    systemPromptExtra?: string | null;
    voiceIdCa?: string | null;
  } | null;
};

export type OnboardingState = {
  onboardingDone: boolean;
  onboardingCompletedAt: string | null;
  onboardingActivatedAt: string | null;
  onboardingLastSeenAt: string | null;
  firstCallAt: string | null;
  currentStep: OnboardingStep;
  completedCount: number;
  totalCount: number;
  progress: number;
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
