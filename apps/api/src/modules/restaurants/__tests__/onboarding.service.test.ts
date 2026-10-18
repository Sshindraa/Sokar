import { describe, it, expect } from 'vitest';
import {
  applyOnboardingTransition,
  computeOnboardingState,
  hasConfiguredRules,
  hasOpeningHours,
  hasUsablePhone,
  normalizeTasks,
  ONBOARDING_STEPS,
  type OnboardingTasksMap,
} from '../onboarding.service';

const baseEmpty = {
  name: 'Le Bistrot Sokar',
  managerPhone: '+33600000002',
  managerEmail: 'restaurant@sokar.tech',
  openingHours: {},
  personality: null,
  googleRefreshToken: null,
  phoneNumber: '+0000000000',
  onboardingTasks: null,
};

const floorStats = { tableCount: 10, seatCount: 40, largestTableCapacity: 6 };
const answeredPractical = {
  terrace: true,
  parking: 'onsite',
  accessible: true,
  pets: 'yes',
  kidsMenu: true,
  privatization: false,
};

const fullRestaurant = {
  name: 'Le Bistrot Sokar',
  phoneE164: '+33600000001',
  managerPhone: '+33600000002',
  managerEmail: 'restaurant@sokar.tech',
  floorStats,
  practicalInfo: answeredPractical,
  exposureSettings: { capacitySpecials: { serviceDurationMinutes: 90 } },
  // Ancienne tâche conservée dans le contrat API.
  onboardingTasks: { channels: { status: 'completed' } },
  openingHours: { mon: { open: '12:00', close: '22:00' } },
  personality: { id: 'p1' },
  googleRefreshToken: 'rt-123',
  phoneNumber: '+33612345678',
};

function getStatus(tasks: OnboardingTasksMap, key: string) {
  return tasks[key as keyof OnboardingTasksMap].status;
}

describe('computeOnboardingState', () => {
  it('cas 1 : sans numéro public, restaurant reste à compléter', () => {
    const state = computeOnboardingState(baseEmpty);
    expect(state.completedCount).toBe(0);
    expect(getStatus(state.tasks, 'restaurant')).toBe('current');
    expect(state.onboardingDone).toBe(false);
    expect(state.progress).toBe(0);
    expect(state.currentStep.key).toBe('restaurant');
  });

  it('cas 2 : restaurant pleinement configuré (Voice) → onboardingDone = true, progress = 75', () => {
    const state = computeOnboardingState(fullRestaurant);
    expect(state.completedCount).toBe(6);
    expect(state.onboardingDone).toBe(true);
    expect(state.progress).toBe(75);
    for (const step of state.steps.filter((s) => s.group === 'voice')) {
      expect(step.status).toBe('completed');
    }
  });

  it('acquiert le contrôle historique sans étape dédiée lorsque le socle est prêt', () => {
    const state = computeOnboardingState({ ...fullRestaurant, onboardingTasks: null });
    expect(state.tasks.channels.status).toBe('completed');
    expect(state.voiceOnboardingDone).toBe(true);
    expect(state.currentStep.key).toBe('connect-identity');
  });

  it('ne valide pas le contrôle historique si la salle manque', () => {
    const state = computeOnboardingState({
      ...fullRestaurant,
      onboardingTasks: null,
      floorStats: { tableCount: 0, seatCount: 0, largestTableCapacity: 0 },
    });
    expect(state.tasks.channels.status).not.toBe('completed');
    expect(state.readiness.ready).toBe(false);
  });

  it('cas 3 : name = "Mon Restaurant" (placeholder) ne marque PAS restaurant completed', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      name: 'Mon Restaurant',
      onboardingTasks: null,
    });
    // Aucune info restaurant n'est considérée comme complète → on retombe sur l'init
    expect(getStatus(state.tasks, 'restaurant')).toBe('current');
    expect(state.completedCount).toBe(0);
    expect(state.onboardingDone).toBe(false);
  });

  it('cas 4 : phoneNumber en +000 n’est PAS utilisable (cas test)', () => {
    expect(hasUsablePhone('+0000000000')).toBe(false);
    expect(hasUsablePhone('+33600000000')).toBe(true);
    expect(hasUsablePhone(null)).toBe(false);
    expect(hasUsablePhone(undefined)).toBe(false);
  });

  it('cas 5 : openingHours vide {} ne compte PAS comme configuré', () => {
    expect(hasOpeningHours({})).toBe(false);
    expect(hasOpeningHours(null)).toBe(false);
    expect(hasOpeningHours({ tue: { open: '12:00', close: '22:00' } })).toBe(true);
  });

  it('cas 6 : un état "blocked" pour phone est préservé par le compute', () => {
    const stored = {
      phone: { status: 'blocked', reason: 'Renvoi opérateur impossible', blockedAt: 'now' },
    };
    const state = computeOnboardingState({ ...baseEmpty, onboardingTasks: stored });
    expect(getStatus(state.tasks, 'phone')).toBe('blocked');
  });

  it('cas 6 bis : une ancienne tâche "calendar" enregistrée est ignorée', () => {
    const stored = { calendar: { status: 'completed', completedAt: 'now' } };
    const state = computeOnboardingState({ ...baseEmpty, onboardingTasks: stored });
    expect(state.steps.map((step) => step.key)).not.toContain('calendar');
  });

  it('cas 7 : minimumViableDone est false quand restaurant OU hours est incomplet', () => {
    // Le numéro public est saisi ; hours reste incomplet.
    const state = computeOnboardingState({ ...baseEmpty, phoneE164: '+33600000001' });
    expect(getStatus(state.tasks, 'restaurant')).toBe('completed');
    expect(getStatus(state.tasks, 'hours')).toBe('current');
    expect(state.minimumViableDone).toBe(false);
  });

  it('cas 8 : minimumViableDone exige restaurant, hours, floor ET règles completed', () => {
    const partial = {
      ...baseEmpty,
      phoneE164: '+33600000001',
      openingHours: { mon: { open: '12:00', close: '22:00' } },
    };
    const withoutFloor = computeOnboardingState(partial);
    expect(getStatus(withoutFloor.tasks, 'restaurant')).toBe('completed');
    expect(getStatus(withoutFloor.tasks, 'hours')).toBe('completed');
    expect(withoutFloor.minimumViableDone).toBe(false);

    const complete = computeOnboardingState({
      ...partial,
      floorStats,
      practicalInfo: answeredPractical,
      exposureSettings: { capacitySpecials: { serviceDurationMinutes: 90 } },
    });
    expect(complete.minimumViableDone).toBe(true);
  });

  it('cas 9 : skip de hours ne compte pas pour minimumViableDone (skip ≠ completed)', () => {
    const tasks = normalizeTasks(null);
    const after = applyOnboardingTransition(tasks, {
      action: 'skip',
      task: 'hours',
      reason: 'Plus tard',
    });
    const state = computeOnboardingState({ ...baseEmpty, onboardingTasks: after });
    expect(getStatus(state.tasks, 'hours')).toBe('skipped');
    expect(state.minimumViableDone).toBe(false);
  });

  it('cas 10 : minimumViableDone reste false si restaurant est "Mon Restaurant" (placeholder)', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      name: 'Mon Restaurant',
      openingHours: { mon: { open: '12:00', close: '22:00' } },
    });
    expect(getStatus(state.tasks, 'restaurant')).toBe('current');
    expect(state.minimumViableDone).toBe(false);
  });
});

describe('applyOnboardingTransition', () => {
  it('start : met l’étape demandée en current, rétrograde l’ancienne', () => {
    const tasks = normalizeTasks(null);
    const next = applyOnboardingTransition(tasks, {
      action: 'start',
      task: 'knowledge',
    });
    expect(next.hours.status).toBe('pending');
    expect(next.knowledge.status).toBe('current');
  });

  it('complete : passe l’étape en completed avec completedAt', () => {
    const tasks = normalizeTasks(null);
    const next = applyOnboardingTransition(tasks, {
      action: 'complete',
      task: 'hours',
    });
    expect(next.hours.status).toBe('completed');
    expect(next.hours.completedAt).toBeDefined();
  });

  it('skip : impossible sur restaurant (étape required)', () => {
    const tasks = normalizeTasks(null);
    expect(() => applyOnboardingTransition(tasks, { action: 'skip', task: 'restaurant' })).toThrow(
      /obligatoire/i,
    );
  });

  it('skip : autorisé sur hours, et passe l’étape suivante en current (après compute)', () => {
    const tasks = normalizeTasks(null);
    const after = applyOnboardingTransition(tasks, {
      action: 'skip',
      task: 'hours',
      reason: 'Plus tard',
    });
    expect(after.hours.status).toBe('skipped');
    expect(after.hours.reason).toBe('Plus tard');

    // L’étape suivante (floor) doit prendre le relais APRÈS recompute,
    // comme le fait la route PATCH (applyOnboardingTransition → computeOnboardingState).
    const state = computeOnboardingState({
      ...baseEmpty,
      phoneE164: '+33600000001',
      onboardingTasks: after,
    });
    expect(state.currentStep.key).toBe('floor');
    expect(state.currentStep.status).toBe('current');
  });

  it('seen / activate / first_call ne mutent pas le state', () => {
    const tasks = normalizeTasks(null);
    const before = JSON.stringify(tasks);
    for (const action of ['seen', 'activate', 'first_call'] as const) {
      const after = applyOnboardingTransition(tasks, { action });
      expect(JSON.stringify(after)).toBe(before);
    }
  });

  it('gère l’onboarding Sokar Connect : complétion et calcul des progrès indépendants', () => {
    const emptyState = computeOnboardingState({ ...baseEmpty, phoneE164: '+33600000001' });
    expect(emptyState.voiceOnboardingDone).toBe(false);
    expect(emptyState.connectOnboardingDone).toBe(false);
    expect(emptyState.voiceProgress).toBe(17);
    expect(emptyState.connectProgress).toBe(0);

    const withConnectInfo = {
      ...baseEmpty,
      slug: 'bistrot-test',
      description: 'Super description',
      coverImageUrl: 'http://image.url/cover.jpg',
      formattedAddress: '1 rue test',
      city: 'Lyon',
      postalCode: '69001',
      lat: 45.76,
      lng: 4.83,
      cuisineType: ['Français'],
      priceRange: 2,
      exposureSettings: {
        connectPublished: true,
      },
    };

    const state = computeOnboardingState(withConnectInfo);
    expect(state.connectProgress).toBe(100);
    expect(state.connectOnboardingDone).toBe(true);
  });
});

describe('étape floor (votre salle)', () => {
  it('se complète d’elle-même avec une table active et des règles enregistrées', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      phoneE164: '+33600000001',
      floorStats,
      practicalInfo: answeredPractical,
      exposureSettings: { capacitySpecials: { serviceDurationMinutes: 90 } },
    });
    expect(getStatus(state.tasks, 'floor')).toBe('completed');
  });

  it('reste à faire sans table', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      phoneE164: '+33600000001',
      openingHours: { mon: { open: '12:00', close: '22:00' } },
      floorStats: { tableCount: 0, seatCount: 0, largestTableCapacity: 0 },
    });
    expect(getStatus(state.tasks, 'floor')).toBe('current');
  });

  it('garde l’état stocké quand l’appelant n’a pas chargé les tables', () => {
    const stored = { floor: { status: 'completed', completedAt: 'then' } };
    const state = computeOnboardingState({ ...baseEmpty, onboardingTasks: stored });
    expect(getStatus(state.tasks, 'floor')).toBe('completed');
  });

  it('se place entre les horaires et les consignes de l’assistant', () => {
    const keys = ONBOARDING_STEPS.filter((step) => step.group === 'voice').map((step) => step.key);
    expect(keys.slice(0, 4)).toEqual(['restaurant', 'hours', 'floor', 'knowledge']);
  });

  it('ne se complète pas sans les réponses pratiques : elles sont obligatoires', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      phoneE164: '+33600000001',
      floorStats,
      practicalInfo: { terrace: true, parking: 'onsite' },
      exposureSettings: { capacitySpecials: { serviceDurationMinutes: 90 } },
    });
    expect(getStatus(state.tasks, 'floor')).not.toBe('completed');
  });

  it('ne se complète pas d’elle-même sans règles : les tables seules ne suffisent pas', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      phoneE164: '+33600000001',
      floorStats,
      exposureSettings: null,
    });
    expect(getStatus(state.tasks, 'floor')).not.toBe('completed');
  });
});

describe('règles de réservation (dans l’étape floor)', () => {
  it('n’ont plus d’étape à part : Connect compte 4 étapes', () => {
    expect(ONBOARDING_STEPS.some((step) => (step.key as string) === 'connect-capacity')).toBe(
      false,
    );
    expect(ONBOARDING_STEPS.filter((step) => step.group === 'connect')).toHaveLength(4);
  });

  it('comptent comme configurées avec la durée lue par la disponibilité', () => {
    expect(hasConfiguredRules({ serviceDurationMinutes: 90 })).toBe(true);
    expect(hasConfiguredRules({ defaultServiceDurationMinutes: 120 })).toBe(true);
  });

  it('ignorent l’ancienne clé `serviceDuration`, que rien ne lisait', () => {
    expect(hasConfiguredRules({ serviceDuration: 90 })).toBe(false);
    expect(hasConfiguredRules({})).toBe(false);
    expect(hasConfiguredRules(null)).toBe(false);
  });

  it('sans règles, onboardingDone reste false', () => {
    const state = computeOnboardingState({ ...fullRestaurant, exposureSettings: null });
    expect(state.onboardingDone).toBe(false);
    expect(state.readiness.checks.find((check) => check.key === 'rules')?.ok).toBe(false);
  });
});

describe('mobile du gérant', () => {
  it('est requis pour valider « Votre restaurant »', () => {
    const state = computeOnboardingState({
      ...baseEmpty,
      phoneE164: '+33600000001',
      managerPhone: '',
    });
    expect(getStatus(state.tasks, 'restaurant')).toBe('current');
  });
});

describe('readiness (prêt à réserver)', () => {
  it('est prête avec horaires, tables et règles', () => {
    const { readiness } = computeOnboardingState(fullRestaurant);
    expect(readiness.ready).toBe(true);
    expect(readiness.checks.every((check) => check.ok)).toBe(true);
    expect(readiness).toMatchObject({ tableCount: 10, seatCount: 40, largestTableCapacity: 6 });
  });

  it.each([
    ['les horaires', { openingHours: {} }, 'hours'],
    [
      'les tables',
      { floorStats: { tableCount: 0, seatCount: 0, largestTableCapacity: 0 } },
      'tables',
    ],
    ['les règles', { exposureSettings: null }, 'rules'],
  ])('n’est pas prête sans %s', (_label, override, missing) => {
    const { readiness } = computeOnboardingState({ ...fullRestaurant, ...override });
    expect(readiness.ready).toBe(false);
    expect(readiness.checks.filter((check) => !check.ok).map((check) => check.key)).toEqual([
      missing,
    ]);
  });

  it('compte zéro table quand les tables n’ont pas été chargées', () => {
    const { readiness } = computeOnboardingState({ ...fullRestaurant, floorStats: undefined });
    expect(readiness.ready).toBe(false);
    expect(readiness.tableCount).toBe(0);
  });
});

describe('Connect en deux étapes compatibles', () => {
  it('avance de la page vers la publication sans exiger cuisine, description ou photo', () => {
    const state = computeOnboardingState({
      ...fullRestaurant,
      slug: 'bistrot-test',
      formattedAddress: '1 rue test',
      city: 'Lyon',
      postalCode: '69001',
      lat: 45.76,
      lng: 4.83,
    });
    expect(state.tasks['connect-identity'].status).toBe('completed');
    expect(state.tasks['connect-activation'].status).toBe('current');
    expect(state.connectProgress).toBe(50);
    expect(state.steps.some((step) => step.key === 'connect-cuisine')).toBe(true);
  });
  it('termine Connect après publication même sans les anciennes tâches', () => {
    const state = computeOnboardingState({
      ...fullRestaurant,
      slug: 'bistrot-test',
      exposureSettings: { ...fullRestaurant.exposureSettings, connectPublished: true },
    });
    expect(state.connectOnboardingDone).toBe(true);
    expect(state.connectProgress).toBe(100);
    expect(state.progress).toBe(100);
    expect(state.completedCount).toBe(state.totalCount);
    expect(state.tasks['connect-location'].status).not.toBe('completed');
    expect(state.tasks['connect-cuisine'].status).not.toBe('completed');
  });
});
