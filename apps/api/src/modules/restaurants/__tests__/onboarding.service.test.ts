import { describe, it, expect } from 'vitest';
import {
  applyOnboardingTransition,
  computeOnboardingState,
  hasOpeningHours,
  hasUsablePhone,
  normalizeTasks,
  ONBOARDING_STEPS,
  type OnboardingTasksMap,
} from '../onboarding.service';

const baseEmpty = {
  name: 'Le Bistrot Sokar',
  managerPhone: '+33600000000',
  managerEmail: 'gerant@sokar.tech',
  openingHours: {},
  personality: null,
  googleRefreshToken: null,
  phoneNumber: '+0000000000',
  onboardingTasks: null,
};

const fullRestaurant = {
  name: 'Le Bistrot Sokar',
  managerPhone: '+33600000000',
  managerEmail: 'gerant@sokar.tech',
  openingHours: { mon: { open: '12:00', close: '22:00' } },
  personality: { id: 'p1' },
  googleRefreshToken: 'rt-123',
  phoneNumber: '+33612345678',
  onboardingTasks: null,
};

function getStatus(tasks: OnboardingTasksMap, key: string) {
  return tasks[key as keyof OnboardingTasksMap].status;
}

describe('computeOnboardingState', () => {
  it('cas 1 : restaurant vide → seul `restaurant` peut être completed, le reste en pending/current', () => {
    const state = computeOnboardingState(baseEmpty);
    expect(state.completedCount).toBe(1);
    expect(getStatus(state.tasks, 'restaurant')).toBe('completed');
    expect(state.onboardingDone).toBe(false);
    expect(state.progress).toBe(20);
    expect(state.currentStep.key).not.toBe('restaurant');
  });

  it('cas 2 : restaurant pleinement configuré → onboardingDone = true, progress = 100', () => {
    const state = computeOnboardingState(fullRestaurant);
    expect(state.completedCount).toBe(ONBOARDING_STEPS.length);
    expect(state.onboardingDone).toBe(true);
    expect(state.progress).toBe(100);
    for (const step of state.steps) {
      expect(step.status).toBe('completed');
    }
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

  it('cas 6 : un état "blocked" pour calendar est préservé par le compute', () => {
    const stored = {
      calendar: { status: 'blocked', reason: 'Google OAuth cassé', blockedAt: 'now' },
    };
    const state = computeOnboardingState({ ...baseEmpty, onboardingTasks: stored });
    // calendar est bloqué manuellement → ne devient pas completed même si googleRefreshToken
    expect(getStatus(state.tasks, 'calendar')).toBe('blocked');
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
    expect(() =>
      applyOnboardingTransition(tasks, { action: 'skip', task: 'restaurant' }),
    ).toThrow(/obligatoire/i);
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

    // L’étape suivante (knowledge) doit prendre le relais APRÈS recompute,
    // comme le fait la route PATCH (applyOnboardingTransition → computeOnboardingState).
    const state = computeOnboardingState({
      ...baseEmpty,
      onboardingTasks: after,
    });
    expect(state.currentStep.key).toBe('knowledge');
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
});
