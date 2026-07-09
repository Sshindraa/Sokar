export type StepProps = {
  onComplete: (nextStep: OnboardingTaskKey | null) => void;
};

export type OnboardingStatus = 'completed' | 'current' | 'blocked' | 'skipped' | 'pending';

export type OnboardingTaskKey =
  | 'restaurant'
  | 'hours'
  | 'knowledge'
  | 'calendar'
  | 'phone'
  | 'connect-identity'
  | 'connect-location'
  | 'connect-cuisine'
  | 'connect-capacity'
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

export type OnboardingState = {
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
