import { z } from 'zod';

export const ONBOARDING_TASK_KEYS = [
  'restaurant',
  'hours',
  'knowledge',
  'calendar',
  'phone',
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
}> = [
  {
    key: 'restaurant',
    title: 'Identité du restaurant',
    description: 'Nom, gérant et coordonnées de contact.',
    required: true,
  },
  {
    key: 'hours',
    title: 'Quand répondre et réserver',
    description: "Créneaux d'ouverture que l'assistant peut proposer.",
    required: false,
  },
  {
    key: 'knowledge',
    title: "Ce que l'assistant doit savoir",
    description: 'Ton, ambiance et consignes commerciales.',
    required: false,
  },
  {
    key: 'calendar',
    title: 'Connexion au planning',
    description: 'Google Calendar ou fallback manuel.',
    required: false,
  },
  {
    key: 'phone',
    title: 'Mise en service des appels',
    description: 'Numéro Sokar et consignes de renvoi opérateur.',
    required: false,
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
};

export type OnboardingStepView = {
  key: OnboardingTask;
  title: string;
  description: string;
  required: boolean;
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
  onboardingDone: boolean;
};

export function computeOnboardingState(restaurant: RestaurantLike): OnboardingStateView {
  const now = new Date().toISOString();
  const tasks = normalizeTasks(restaurant.onboardingTasks);

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

  const current = ONBOARDING_STEPS.find((step) => tasks[step.key].status === 'current');
  if (!current || tasks[current.key].status === 'completed') {
    const next = ONBOARDING_STEPS.find(
      (step) => !['completed', 'skipped'].includes(tasks[step.key].status),
    );
    for (const step of ONBOARDING_STEPS) {
      if (tasks[step.key].status === 'current') {
        tasks[step.key] = { ...tasks[step.key], status: 'pending' };
      }
    }
    if (next && tasks[next.key].status !== 'blocked') {
      tasks[next.key] = { ...tasks[next.key], status: 'current' };
    }
  }

  const completedCount = ONBOARDING_STEPS.filter(
    (step) => tasks[step.key].status === 'completed',
  ).length;
  const onboardingDone = completedCount === ONBOARDING_STEPS.length;
  const steps: OnboardingStepView[] = ONBOARDING_STEPS.map((step, index) => ({
    ...step,
    index: index + 1,
    status: tasks[step.key].status,
    state: tasks[step.key],
  }));
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
    onboardingDone,
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
    for (const step of ONBOARDING_STEPS) {
      if (tasks[step.key].status === 'current') {
        tasks[step.key] = { ...tasks[step.key], status: 'pending' };
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

  const next = ONBOARDING_STEPS.find((step) => tasks[step.key].status === 'pending');
  if (
    !ONBOARDING_STEPS.some((step) => tasks[step.key].status === 'current') &&
    next
  ) {
    tasks[next.key] = { ...tasks[next.key], status: 'current' };
  }

  return tasks;
}
