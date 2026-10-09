import { z } from 'zod';
import { hasAnsweredPracticalInfo } from './practical-info';

export const ONBOARDING_TASK_KEYS = [
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

// Les tâches `restaurant`, `hours` et `floor` forment le socle commun à tous les canaux (téléphone,
// widget, Google, MCP). `floor` couvre les tables, les règles de réservation (durée d'un repas, taille
// maximale des groupes, annulation, acompte) et les informations pratiques facultatives (parking,
// accessibilité, animaux…) : tout cela vaut pour tous les canaux.
export const ONBOARDING_STEPS: ReadonlyArray<{
  key: OnboardingTask;
  title: string;
  description: string;
  required: boolean;
  group: 'voice' | 'connect';
  index: number;
}> = [
  // Voice group
  {
    key: 'restaurant',
    title: 'Vérifions votre restaurant',
    description: 'Nom et coordonnées de contact du restaurant.',
    required: true,
    group: 'voice',
    index: 1,
  },
  {
    key: 'hours',
    title: 'Quand prenez-vous des réservations ?',
    description: 'Horaires des créneaux proposés par Sokar.',
    required: false,
    group: 'voice',
    index: 2,
  },
  {
    key: 'floor',
    title: 'Votre salle et vos règles',
    description:
      'Vos tables, vos règles de réservation et, si vous le souhaitez, les informations pratiques que vos clients demandent.',
    required: false,
    group: 'voice',
    index: 3,
  },
  {
    key: 'knowledge',
    title: 'Consignes & démo',
    description: 'Ton, ambiance et consignes commerciales.',
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
  {
    key: 'channels',
    title: 'Vos canaux de réservation',
    description: 'Test des disponibilités avant la configuration de la page Sokar Connect.',
    required: false,
    group: 'voice',
    index: 6,
  },
  // Sokar Connect group
  {
    key: 'connect-identity',
    title: 'Votre page',
    description: 'Présentation, photo et informations publiques.',
    required: false,
    group: 'connect',
    index: 1,
  },
  {
    key: 'connect-location',
    title: 'Localisation',
    description: 'Adresse, coordonnées et carte.',
    required: false,
    group: 'connect',
    index: 2,
  },
  {
    key: 'connect-cuisine',
    title: 'Cuisine & ambiance',
    description: 'Type de cuisine, tarifs et spécificités.',
    required: false,
    group: 'connect',
    index: 3,
  },
  {
    key: 'connect-activation',
    title: 'Publication',
    description: 'Mise en ligne de la page et des métadonnées.',
    required: false,
    group: 'connect',
    index: 4,
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

  return ONBOARDING_STEPS.reduce((acc, step, index) => {
    const stored = source[step.key] ?? {};
    const parsed = z.enum(ONBOARDING_STATUSES).safeParse(stored.status);
    acc[step.key] = {
      ...stored,
      status: parsed.success ? parsed.data : index === 0 ? 'current' : 'pending',
    };
    return acc;
  }, {} as OnboardingTasksMap);
}

export function hasOpeningHours(openingHours: unknown): boolean {
  return Boolean(
    openingHours &&
    typeof openingHours === 'object' &&
    !Array.isArray(openingHours) &&
    Object.keys(openingHours).length > 0,
  );
}

/**
 * Les règles sont configurées quand la durée d'un repas est explicite : c'est la clé que la
 * disponibilité lit (`resolveServiceDurationMinutes`). L'ancienne clé `serviceDuration` n'était lue
 * par rien, elle ne compte donc pas.
 */
export function hasConfiguredRules(capacitySpecials: unknown): boolean {
  if (
    !capacitySpecials ||
    typeof capacitySpecials !== 'object' ||
    Array.isArray(capacitySpecials)
  ) {
    return false;
  }
  const specials = capacitySpecials as Record<string, unknown>;
  return [specials.serviceDurationMinutes, specials.defaultServiceDurationMinutes].some(
    (value) => typeof value === 'number' && value > 0,
  );
}

export function hasUsablePhone(phoneNumber: string | null | undefined): boolean {
  return Boolean(phoneNumber && !phoneNumber.startsWith('+000'));
}

function markCompleted(tasks: OnboardingTasksMap, task: OnboardingTask, now: string): void {
  if (tasks[task].status === 'completed') return;
  tasks[task] = {
    ...tasks[task],
    status: 'completed',
    completedAt: now,
    reason: undefined,
    blockedAt: undefined,
  };
}

/** Tables actives du restaurant, telles que la disponibilité les voit (plans de salle actifs). */
export type FloorStats = {
  tableCount: number;
  seatCount: number;
  largestTableCapacity: number;
};

export type RestaurantLike = {
  name?: string | null;
  phoneE164?: string | null;
  managerPhone?: string | null;
  managerEmail?: string | null;
  practicalInfo?: unknown;
  /** Absent : l'appelant ne l'a pas chargé, l'état stocké de `floor` fait foi. */
  floorStats?: FloorStats | null;
  openingHours?: unknown;
  personality?: unknown;
  googleRefreshToken?: string | null;
  googleCalendarId?: string | null;
  phoneNumber?: string | null;
  firstCallAt?: Date | null;
  provisioningStatus?: string | null;
  onboardingTasks?: unknown;
  // Sokar Connect fields
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
    connectPublished?: boolean;
    connectAgentic?: boolean;
    capacitySpecials?: unknown;
  } | null;
};

export type OnboardingStepView = {
  key: OnboardingTask;
  title: string;
  description: string;
  required: boolean;
  group: 'voice' | 'connect';
  index: number;
  status: OnboardingStatus;
  state: OnboardingTaskState;
};

export type OnboardingStateView = {
  steps: OnboardingStepView[];
  tasks: OnboardingTasksMap;
  currentStep: OnboardingStepView;
  completedCount: number;
  totalCount: number;
  progress: number;
  onboardingDone: boolean; // voice onboarding done
  voiceOnboardingDone: boolean;
  connectOnboardingDone: boolean;
  voiceProgress: number;
  connectProgress: number;
  /**
   * Seuil minimum pour accéder au dashboard sans modale bloquante.
   * Requiert que `restaurant`, `hours` ET `floor` (tables et règles) soient `completed`
   * (skip ne compte pas) : le socle sans lequel aucun canal ne peut proposer de créneau.
   */
  minimumViableDone: boolean;
  /** Ce qu'il manque pour qu'un client puisse réserver, quel que soit le canal. */
  readiness: ReservationReadiness;
};

export type ReservationReadinessCheckKey = 'hours' | 'tables' | 'rules';

export type ReservationReadiness = {
  ready: boolean;
  checks: Array<{ key: ReservationReadinessCheckKey; label: string; ok: boolean }>;
  tableCount: number;
  seatCount: number;
  largestTableCapacity: number;
};

/**
 * La disponibilité se calcule sur les tables des plans de salle actifs, les horaires de réservation
 * et les règles (durée de service). Sans l'un des trois, aucun canal ne peut proposer de créneau.
 */
export function computeReservationReadiness(restaurant: RestaurantLike): ReservationReadiness {
  const floor = restaurant.floorStats ?? { tableCount: 0, seatCount: 0, largestTableCapacity: 0 };
  const checks: ReservationReadiness['checks'] = [
    {
      key: 'hours',
      label: 'Horaires de réservation',
      ok: hasOpeningHours(restaurant.openingHours),
    },
    { key: 'tables', label: 'Tables de la salle', ok: floor.tableCount > 0 },
    {
      key: 'rules',
      label: 'Règles de réservation',
      ok: hasConfiguredRules(restaurant.exposureSettings?.capacitySpecials),
    },
  ];
  return {
    ready: checks.every((check) => check.ok),
    checks,
    tableCount: floor.tableCount,
    seatCount: floor.seatCount,
    largestTableCapacity: floor.largestTableCapacity,
  };
}

export function computeOnboardingState(restaurant: RestaurantLike): OnboardingStateView {
  const now = new Date().toISOString();
  const tasks = normalizeTasks(restaurant.onboardingTasks);

  // Auto-completion Voice
  if (
    restaurant.name &&
    restaurant.name !== 'Mon Restaurant' &&
    restaurant.phoneE164 &&
    restaurant.managerPhone?.trim() &&
    restaurant.managerEmail
  ) {
    markCompleted(tasks, 'restaurant', now);
  }

  if (hasOpeningHours(restaurant.openingHours)) {
    markCompleted(tasks, 'hours', now);
  }

  if (
    restaurant.floorStats &&
    restaurant.floorStats.tableCount > 0 &&
    hasConfiguredRules(restaurant.exposureSettings?.capacitySpecials) &&
    hasAnsweredPracticalInfo(restaurant.practicalInfo, restaurant.ambiance)
  ) {
    markCompleted(tasks, 'floor', now);
  }

  if (restaurant.personality) {
    markCompleted(tasks, 'knowledge', now);
  }

  if (hasUsablePhone(restaurant.phoneNumber)) {
    markCompleted(tasks, 'phone', now);
  }

  // Compatibilité : l’ancien contrôle intermédiaire n’exige plus de page dédiée.
  // Conserver la clé dans l’API et ne l’acquérir que lorsque les réservations sont possibles.
  if (computeReservationReadiness(restaurant).ready) {
    markCompleted(tasks, 'channels', now);
  }

  // Auto-completion Sokar Connect
  const hasConnectLocation = Boolean(
    restaurant.formattedAddress &&
    restaurant.city &&
    restaurant.postalCode &&
    restaurant.lat !== null &&
    restaurant.lat !== undefined &&
    restaurant.lng !== null &&
    restaurant.lng !== undefined,
  );
  if (hasConnectLocation) markCompleted(tasks, 'connect-location', now);
  // Photo, présentation et cuisine sont facultatives dans l’éditeur unique.
  if (restaurant.slug && (hasConnectLocation || restaurant.exposureSettings?.connectPublished)) {
    markCompleted(tasks, 'connect-identity', now);
  }

  if (
    restaurant.cuisineType &&
    restaurant.cuisineType.length > 0 &&
    restaurant.priceRange !== null &&
    restaurant.priceRange !== undefined
  ) {
    markCompleted(tasks, 'connect-cuisine', now);
  }

  const exposure = restaurant.exposureSettings;

  if (exposure?.connectPublished) {
    markCompleted(tasks, 'connect-activation', now);
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

  // Progression Sokar Connect group
  // Adresse et cuisine sont intégrées à l’éditeur ; leurs clés restent exposées pour compatibilité.
  const connectSteps = ONBOARDING_STEPS.filter(
    (step) => step.key === 'connect-identity' || step.key === 'connect-activation',
  );
  const connectCurrent = connectSteps.find((step) => tasks[step.key].status === 'current');
  if (!connectCurrent || tasks[connectCurrent.key].status === 'completed') {
    const nextConnect = connectSteps.find(
      (step) => !['completed', 'skipped'].includes(tasks[step.key].status),
    );
    for (const step of connectSteps) {
      if (tasks[step.key].status === 'current') {
        tasks[step.key] = { ...tasks[step.key], status: 'pending' };
      }
    }
    if (nextConnect && tasks[nextConnect.key].status !== 'blocked') {
      tasks[nextConnect.key] = { ...tasks[nextConnect.key], status: 'current' };
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

  const connectCompletedCount = connectSteps.filter(
    (step) => tasks[step.key].status === 'completed',
  ).length;
  const connectOnboardingDone = connectCompletedCount === connectSteps.length;
  const connectProgress = Math.round((connectCompletedCount / connectSteps.length) * 100);

  const activeSteps = steps.filter(
    (step) =>
      step.group === 'voice' ||
      step.key === 'connect-identity' ||
      step.key === 'connect-activation',
  );
  const completedCount = activeSteps.filter((step) => step.status === 'completed').length;
  const currentStep =
    activeSteps.find((step) => step.status === 'current') ??
    activeSteps.find((step) => step.status === 'blocked') ??
    activeSteps.find((step) => step.status !== 'completed') ??
    steps[steps.length - 1];

  const minimumViableDone = (['restaurant', 'hours', 'floor'] as const).every(
    (key) => tasks[key].status === 'completed',
  );

  return {
    steps,
    tasks,
    currentStep,
    completedCount,
    totalCount: activeSteps.length,
    progress: Math.round((completedCount / activeSteps.length) * 100),
    onboardingDone: voiceOnboardingDone,
    voiceOnboardingDone,
    connectOnboardingDone,
    voiceProgress,
    connectProgress,
    minimumViableDone,
    readiness: computeReservationReadiness(restaurant),
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
    if (!groupSteps.some((step) => tasks[step.key].status === 'current') && next) {
      tasks[next.key] = { ...tasks[next.key], status: 'current' };
    }
  }

  return tasks;
}
