/**
 * Agrégation du funnel d'onboarding au niveau d'une cohorte.
 *
 * La route historique `GET /admin/onboarding-funnel` répond pour **un**
 * restaurant, ce qui suffit à déboguer un compte mais pas à mesurer une
 * cohorte de pilotes : on ne peut pas y lire un taux d'abandon par étape, ni le
 * délai jusqu'à la première réservation, qui est le seul indicateur qui dit si
 * l'onboarding produit un restaurant qui travaille (R2-5).
 *
 * Ce module est volontairement pur : il ne connaît ni Prisma ni le réseau, donc
 * les règles d'agrégation sont testables sans base.
 */

export const ONBOARDING_STEP_ORDER = [
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
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEP_ORDER)[number];

export type OnboardingEventRow = {
  restaurantId: string;
  event: string;
  task: string | null;
  createdAt: Date;
};

/** Jalons temporels par restaurant, lus hors des événements d'onboarding. */
export type RestaurantTimeline = {
  restaurantId: string;
  firstReservationAt: Date | null;
};

export type StepFunnel = {
  step: OnboardingStep;
  started: number;
  completed: number;
  skipped: number;
  blocked: number;
  /** Restaurants entrés dans l'étape et jamais ressortis ni complétés. */
  abandoned: number;
  /** % de complétion parmi les entrées. */
  completionRate: number;
};

export type OnboardingCohortFunnel = {
  restaurants: number;
  totalEvents: number;
  steps: StepFunnel[];
  milestones: {
    activated: number;
    firstCall: number;
    demoCallPlayed: number;
  };
  timeToFirstReservation: {
    /** Restaurants dont on connaît le début d'onboarding ET la première résa. */
    measured: number;
    /** Restaurants entrés dans le funnel sans réservation enregistrée à ce jour. */
    pending: number;
    medianHours: number | null;
    p90Hours: number | null;
  };
  /** % d'étapes complétées au moins une fois sur l'ensemble du parcours. */
  overallCompletionRate: number;
};

function percentage(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/**
 * Percentile par interpolation linéaire sur une série déjà triée.
 * `ratio = 0.5` donne la médiane, `0.9` le p90.
 */
function percentile(sortedValues: readonly number[], ratio: number): number | null {
  if (sortedValues.length === 0) return null;
  if (sortedValues.length === 1) return sortedValues[0] ?? null;
  const position = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sortedValues[lower] ?? 0;
  const upperValue = sortedValues[upper] ?? lowerValue;
  if (lower === upper) return lowerValue;
  return Math.round(lowerValue + (upperValue - lowerValue) * (position - lower));
}

/**
 * Délai, en heures, entre le premier événement d'onboarding et la première
 * réservation. Renvoie `null` si l'un des deux repères manque ou si la
 * réservation précède l'onboarding : une durée négative signalerait une donnée
 * incohérente, qu'on préfère ignorer plutôt que de l'afficher comme un résultat.
 */
export function hoursToFirstReservation(startedAt: Date, firstReservationAt: Date): number | null {
  const deltaMs = firstReservationAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs < 0) return null;
  return Math.round(deltaMs / (60 * 60 * 1000));
}

export function aggregateOnboardingCohort(
  events: readonly OnboardingEventRow[],
  timelines: readonly RestaurantTimeline[],
): OnboardingCohortFunnel {
  const startedByRestaurant = new Map<string, Date>();
  for (const event of events) {
    const current = startedByRestaurant.get(event.restaurantId);
    if (!current || event.createdAt < current) {
      startedByRestaurant.set(event.restaurantId, event.createdAt);
    }
  }

  const steps: StepFunnel[] = ONBOARDING_STEP_ORDER.map((step) => {
    const stepEvents = events.filter((event) => event.task === step);
    const started = stepEvents.filter((event) => event.event === 'onboarding_step_started').length;
    const completed = stepEvents.filter(
      (event) => event.event === 'onboarding_step_completed',
    ).length;
    const skipped = stepEvents.filter((event) => event.event === 'onboarding_step_skipped').length;
    const blocked = stepEvents.filter((event) => event.event === 'onboarding_step_blocked').length;
    return {
      step,
      started,
      completed,
      skipped,
      blocked,
      abandoned: Math.max(0, started - completed - skipped),
      completionRate: percentage(completed, started),
    };
  });

  const durations: number[] = [];
  let pending = 0;
  for (const timeline of timelines) {
    const startedAt = startedByRestaurant.get(timeline.restaurantId);
    if (!startedAt) continue;
    if (!timeline.firstReservationAt) {
      pending += 1;
      continue;
    }
    const hours = hoursToFirstReservation(startedAt, timeline.firstReservationAt);
    if (hours !== null) durations.push(hours);
  }
  durations.sort((a, b) => a - b);

  const milestones = {
    activated: events.filter((event) => event.event === 'onboarding_activated').length,
    firstCall: events.filter((event) => event.event === 'onboarding_first_call').length,
    demoCallPlayed: events.filter((event) => event.event === 'onboarding_demo_call_played').length,
  };

  const completedEveryStep = steps.filter((step) => step.completed > 0).length;

  return {
    restaurants: startedByRestaurant.size,
    totalEvents: events.length,
    steps,
    milestones,
    timeToFirstReservation: {
      measured: durations.length,
      pending,
      medianHours: percentile(durations, 0.5),
      p90Hours: percentile(durations, 0.9),
    },
    overallCompletionRate: percentage(completedEveryStep, ONBOARDING_STEP_ORDER.length),
  };
}

export type RestaurantProgress = {
  restaurantId: string;
  startedAt: Date;
  lastEventAt: Date;
  completedSteps: number;
  blockedSteps: number;
  firstReservationAt: Date | null;
  hoursToFirstReservation: number | null;
};

/**
 * Vue par restaurant, triée du plus bloquant au plus avancé. C'est la partie
 * actionnable : un taux d'abandon agrégé dit qu'il y a un problème, cette liste
 * dit chez qui.
 */
export function perRestaurantProgress(
  events: readonly OnboardingEventRow[],
  timelines: readonly RestaurantTimeline[],
): RestaurantProgress[] {
  const byRestaurant = new Map<string, OnboardingEventRow[]>();
  for (const event of events) {
    const bucket = byRestaurant.get(event.restaurantId);
    if (bucket) bucket.push(event);
    else byRestaurant.set(event.restaurantId, [event]);
  }

  const reservationByRestaurant = new Map(
    timelines.map((timeline) => [timeline.restaurantId, timeline.firstReservationAt]),
  );

  const progress: RestaurantProgress[] = [];
  for (const [restaurantId, restaurantEvents] of byRestaurant) {
    const startedAt = restaurantEvents.reduce(
      (earliest, event) => (event.createdAt < earliest ? event.createdAt : earliest),
      restaurantEvents[0]!.createdAt,
    );
    const lastEventAt = restaurantEvents.reduce(
      (latest, event) => (event.createdAt > latest ? event.createdAt : latest),
      restaurantEvents[0]!.createdAt,
    );
    const firstReservationAt = reservationByRestaurant.get(restaurantId) ?? null;
    progress.push({
      restaurantId,
      startedAt,
      lastEventAt,
      completedSteps: restaurantEvents.filter(
        (event) => event.event === 'onboarding_step_completed',
      ).length,
      blockedSteps: restaurantEvents.filter((event) => event.event === 'onboarding_step_blocked')
        .length,
      firstReservationAt,
      hoursToFirstReservation: firstReservationAt
        ? hoursToFirstReservation(startedAt, firstReservationAt)
        : null,
    });
  }

  return progress.sort((a, b) => {
    if (a.firstReservationAt && !b.firstReservationAt) return -1;
    if (!a.firstReservationAt && b.firstReservationAt) return 1;
    if (a.blockedSteps !== b.blockedSteps) return b.blockedSteps - a.blockedSteps;
    return a.completedSteps - b.completedSteps;
  });
}
