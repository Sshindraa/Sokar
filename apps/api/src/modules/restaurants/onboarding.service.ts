import { z } from 'zod';

export const ONBOARDING_TASK_KEYS = [
  'restaurant',
  'hours',
  'knowledge',
  'calendar',
  'phone',
  'canal-a-identity',
  'canal-a-location',
  'canal-a-cuisine',
  'canal-a-capacity',
  'canal-a-activation',
] as const;

export type OnboardingTask = (typeof ONBOARDING_TASK_KEYS)[number];

export const ONBOARDING_STATUSES = [
  'completed',
  'current',
  'blocked',
  'skipped',
  'pending',
] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

export const ONBOARDING_STEPS: ReadonlyArray<{
  key: OnboardingTask;
  title: string;
  description: string;
  required: boolean;
  group: 'voice' | 'canal-a';
  index: number;
}> = [
  // Voice group
  {
    key: 'restaurant',
    title: 'Identité du restaurant',
    description: 'Nom, gérant et coordonnées de contact.',
    required: true,
    group: 'voice',
    index: 1,
  },
  {
    key: 'hours',
    title: 'Quand répondre et réserver',
    description: "Créneaux d'ouverture que l'assistant peut proposer.",
    required: false,
    group: 'voice',
    index: 2,
  },
  {
    key: 'knowledge',
    title: "Ce que l'assistant doit savoir",
    description: 'Ton, ambiance et consignes commerciales.',
    required: false,
    group: 'voice',
    index: 3,
  },
  {
    key: 'calendar',
    title: 'Connexion au planning',
    description: 'Google Calendar ou fallback manuel.',
    required: false,
    group: 'voice',
    index: 4,
  },
  {
    key: 'phone',
    title: 'Mise en service des appels',
    description: 'Numéro Sokar et consignes de renvoi opérateur.',
    required: false,
    group: 'voice',
    index: 5,
  },
  // Canal A group
  {
    key: 'canal-a-identity',
    title: 'Identité publique',
    description: 'Slug, description et photo de couverture.',
    required: false,
    group: 'canal-a',
    index: 1,
  },
  {
    key: 'canal-a-location',
    title: 'Localisation',
    description: 'Adresse, coordonnées et carte.',
    required: false,
    group: 'canal-a',
    index: 2,
  },
  {
    key: 'canal-a-cuisine',
    title: 'Cuisine & ambiance',
    description: 'Type de cuisine, tarifs et spécificités.',
    required: false,
    group: 'canal-a',
    index: 3,
  },
  {
    key: 'canal-a-capacity',
    title: 'Capacité & règles',
    description: 'Capacité d’accueil, durée de service et acompte.',
    required: false,
    group: 'canal-a',
    index: 4,
  },
  {
    key: 'canal-a-activation',
    title: 'Activation & preview',
    description: 'Mise en ligne de la page et des métadonnées.',
    required: false,
    group: 'canal-a',
    index: 5,
  },
];

export type OnboardingTaskState = {
  status: OnboardingStatus;
  completedAt?: string;
  skippedAt?: string;
  blockedAt?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type OnboardingTasksMap = Record<OnboardingTask, OnboardingTaskState>;

export const DEFAULT_HOURS: Record<string, { open: string; close: string }> = {
  tue: { open: '12:00', close: '22:00' },
  wed: { open: '12:00', close: '22:00' },
  thu: { open: '12:00', close: '22:00' },
  fri: { open: '12:00', close: '22:00' },
  sat: { open: '12:00', close: '22:00' },
};

export const UpdateOnboardingSchema = z.object({
  action: z
    .enum(['seen', 'start', 'complete', 'skip', 'block', 'activate', 'first_call'])
    .default('seen'),
  task: z.enum(ONBOARDING_TASK_KEYS).optional(),
  status: z.enum(ONBOARDING_STATUSES).optional(),
  reason: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type UpdateOnboardingInput = z.infer<typeof UpdateOnboardingSchema>;
export type OnboardingAnalyticsAction = Exclude<
  UpdateOnboardingInput['action'],
  'seen' | 'first_call'
>;

export function normalizeTasks(raw: unknown): OnboardingTasksMap {
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, Partial<OnboardingTaskState>>)
      : {};

  return ONBOARDING_STEPS.reduce(
    (acc, step, index) => {
      const stored = source[step.key] ?? {};
      const parsed = z.enum(ONBOARDING_STATUSES).safeParse(stored.status);
      acc[step.key] = {
        ...stored,
        status: parsed.success ? parsed.data : index === 0 ? 'current' : 'pending',
      };
      return acc;
    },
    {} as OnboardingTasksMap,
  );
}

export function hasOpeningHours(openingHours: unknown): boolean {
  return Boolean(
    openingHours &&
      typeof openingHours === 'object' &&
      !Array.isArray(openingHours) &&
      Object.keys(openingHours).length > 0,
  );
}

export function hasUsablePhone(phoneNumber: string | null | undefined): boolean {
  return Boolean(phoneNumber && !phoneNumber.startsWith('+000'));
}

function markCompleted(
  tasks: OnboardingTasksMap,
  task: OnboardingTask,
  now: string,
): void {
  if (tasks[task].status === 'completed') return;
  tasks[task] = {
    ...tasks[task],
    status: 'completed',
    completedAt: now,
    reason: undefined,
    blockedAt: undefined,
  };
}

export type RestaurantLike = {
  name?: string | null;
  managerPhone?: string | null;
  managerEmail?: string | null;
  openingHours?: unknown;
  personality?: unknown;
  googleRefreshToken?: string | null;
  googleCalendarId?: string | null;
  phoneNumber?: string | null;
  onboardingTasks?: unknown;
  // Canal A fields
  slug?: string | null;
  description?: string | null;
  formattedAddress?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  lat?: unknown;
  lng?: unknown;
  cuisineType?: string[];
  priceRange?: number | null;
  ambiance?: string[];
  dietary?: string[];
  coverImageUrl?: string | null;
  images?: Array<unknown>;
  exposureSettings?: {
    canalAPublished?: boolean;
    canalAAgentic?: boolean;
    capacitySpecials?: unknown;
  } | null;
};

export type OnboardingStepView = {
  key: OnboardingTask;
  title: string;
  description: string;
  required: boolean;
  group: 'voice' | 'canal-a';
  index: number;
  status: OnboardingStatus;
  state: OnboardingTaskState;
};

export type OnboardingStateView = {
  steps: OnboardingStepView[];
  tasks: OnboardingTasksMap;
  currentStep: OnboardingStepView;
  completedCount: number;
  progress: number;
  onboardingDone: boolean; // voice onboarding done
  voiceOnboardingDone: boolean;
  canalAOnboardingDone: boolean;
  voiceProgress: number;
  canalAProgress: number;
};

export function computeOnboardingState(restaurant: RestaurantLike): OnboardingStateView {
  const now = new Date().toISOString();
  const tasks = normalizeTasks(restaurant.onboardingTasks);

  // Auto-completion Voice
  if (
    restaurant.name &&
    restaurant.name !== 'Mon Restaurant' &&
    restaurant.managerPhone &&
    restaurant.managerEmail
  ) {
    markCompleted(tasks, 'restaurant', now);
  }

  if (hasOpeningHours(restaurant.openingHours)) {
    markCompleted(tasks, 'hours', now);
  }

  if (restaurant.personality) {
    markCompleted(tasks, 'knowledge', now);
  }

  if (restaurant.googleRefreshToken) {
    markCompleted(tasks, 'calendar', now);
  }

  if (hasUsablePhone(restaurant.phoneNumber)) {
    markCompleted(tasks, 'phone', now);
  }

  // Auto-completion Canal A
  const hasCoverImage = restaurant.coverImageUrl || (restaurant.images && restaurant.images.length > 0);
  if (restaurant.slug && restaurant.description && hasCoverImage) {
    markCompleted(tasks, 'canal-a-identity', now);
  }

  if (
    restaurant.formattedAddress &&
    restaurant.city &&
    restaurant.postalCode &&
    restaurant.lat !== null &&
    restaurant.lat !== undefined &&
    restaurant.lng !== null &&
    restaurant.lng !== undefined
  ) {
    markCompleted(tasks, 'canal-a-location', now);
  }

  if (
    restaurant.cuisineType &&
    restaurant.cuisineType.length > 0 &&
    restaurant.priceRange !== null &&
    restaurant.priceRange !== undefined
  ) {
    markCompleted(tasks, 'canal-a-cuisine', now);
  }

  const exposure = restaurant.exposureSettings;
  const hasCapacitySpecials =
    exposure?.capacitySpecials &&
    typeof exposure.capacitySpecials === 'object' &&
    Object.keys(exposure.capacitySpecials).length > 0;
  if (hasCapacitySpecials) {
    markCompleted(tasks, 'canal-a-capacity', now);
  }

  if (exposure?.canalAPublished) {
    markCompleted(tasks, 'canal-a-activation', now);
  }

  // Progression Voice group
  const voiceSteps = ONBOARDING_STEPS.filter((step) => step.group === 'voice');
  const voiceCurrent = voiceSteps.find((step) => tasks[step.key].status === 'current');
  if (!voiceCurrent || tasks[voiceCurrent.key].status === 'completed') {
    const nextVoice = voiceSteps.find(
      (step) => !['completed', 'skipped'].includes(tasks[step.key].status),
    );
    for (const step of voiceSteps) {
      if (tasks[step.key].status === 'current') {
        tasks[step.key] = { ...tasks[step.key], status: 'pending' };
      }
    }
    if (nextVoice && tasks[nextVoice.key].status !== 'blocked') {
      tasks[nextVoice.key] = { ...tasks[nextVoice.key], status: 'current' };
    }
  }

  // Progression Canal A group
  const canalASteps = ONBOARDING_STEPS.filter((step) => step.group === 'canal-a');
  const canalACurrent = canalASteps.find((step) => tasks[step.key].status === 'current');
  if (!canalACurrent || tasks[canalACurrent.key].status === 'completed') {
    const nextCanalA = canalASteps.find(
      (step) => !['completed', 'skipped'].includes(tasks[step.key].status),
    );
    for (const step of canalASteps) {
      if (tasks[step.key].status === 'current') {
        tasks[step.key] = { ...tasks[step.key], status: 'pending' };
      }
    }
    if (nextCanalA && tasks[nextCanalA.key].status !== 'blocked') {
      tasks[nextCanalA.key] = { ...tasks[nextCanalA.key], status: 'current' };
    }
  }

  const steps: OnboardingStepView[] = ONBOARDING_STEPS.map((step) => ({
    ...step,
    status: tasks[step.key].status,
    state: tasks[step.key],
  }));

  const voiceCompletedCount = voiceSteps.filter(
    (step) => tasks[step.key].status === 'completed',
  ).length;
  const voiceOnboardingDone = voiceCompletedCount === voiceSteps.length;
  const voiceProgress = Math.round((voiceCompletedCount / voiceSteps.length) * 100);

  const canalACompletedCount = canalASteps.filter(
    (step) => tasks[step.key].status === 'completed',
  ).length;
  const canalAOnboardingDone = canalACompletedCount === canalASteps.length;
  const canalAProgress = Math.round((canalACompletedCount / canalASteps.length) * 100);

  const completedCount = ONBOARDING_STEPS.filter(
    (step) => tasks[step.key].status === 'completed',
  ).length;

  const currentStep =
    steps.find((step) => step.status === 'current') ??
    steps.find((step) => step.status === 'blocked') ??
    steps.find((step) => step.status !== 'completed') ??
    steps[steps.length - 1];

  return {
    steps,
    tasks,
    currentStep,
    completedCount,
    progress: Math.round((completedCount / ONBOARDING_STEPS.length) * 100),
    onboardingDone: voiceOnboardingDone,
    voiceOnboardingDone,
    canalAOnboardingDone,
    voiceProgress,
    canalAProgress,
  };
}

export function applyOnboardingTransition(
  tasks: OnboardingTasksMap,
  body: UpdateOnboardingInput,
): OnboardingTasksMap {
  const now = new Date().toISOString();
  const task = body.task;

  if (body.action === 'seen' || body.action === 'activate' || body.action === 'first_call') {
    return tasks;
  }

  if (!task) {
    throw new Error('task is required for this onboarding action');
  }

  if (body.action === 'skip' && task === 'restaurant') {
    throw new Error("L'identité du restaurant est obligatoire");
  }

  if (body.action === 'start') {
    const stepDef = ONBOARDING_STEPS.find((s) => s.key === task);
    if (stepDef) {
      const groupSteps = ONBOARDING_STEPS.filter((s) => s.group === stepDef.group);
      for (const step of groupSteps) {
        if (tasks[step.key].status === 'current') {
          tasks[step.key] = { ...tasks[step.key], status: 'pending' };
        }
      }
    }
    if (tasks[task].status !== 'completed') {
      tasks[task] = { ...tasks[task], status: 'current' };
    }
  }

  if (body.action === 'complete') {
    tasks[task] = {
      ...tasks[task],
      status: 'completed',
      completedAt: now,
      reason: undefined,
      blockedAt: undefined,
      metadata: body.metadata ?? tasks[task].metadata,
    };
  }

  if (body.action === 'skip') {
    tasks[task] = {
      ...tasks[task],
      status: 'skipped',
      skippedAt: now,
      reason: body.reason,
      metadata: body.metadata ?? tasks[task].metadata,
    };
  }

  if (body.action === 'block') {
    tasks[task] = {
      ...tasks[task],
      status: 'blocked',
      blockedAt: now,
      reason: body.reason,
      metadata: body.metadata ?? tasks[task].metadata,
    };
  }

  // Auto-progression pour le groupe concerné
  const stepDef = ONBOARDING_STEPS.find((s) => s.key === task);
  if (stepDef) {
    const groupSteps = ONBOARDING_STEPS.filter((s) => s.group === stepDef.group);
    const next = groupSteps.find((step) => tasks[step.key].status === 'pending');
    if (
      !groupSteps.some((step) => tasks[step.key].status === 'current') &&
      next
    ) {
      tasks[next.key] = { ...tasks[next.key], status: 'current' };
    }
  }

  return tasks;
}
