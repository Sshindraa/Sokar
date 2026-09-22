import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STEP_ORDER,
  aggregateOnboardingCohort,
  hoursToFirstReservation,
  perRestaurantProgress,
  type OnboardingEventRow,
  type RestaurantTimeline,
} from '../onboarding-funnel.service';

const T0 = new Date('2026-09-01T10:00:00.000Z');

function hoursAfter(hours: number): Date {
  return new Date(T0.getTime() + hours * 60 * 60 * 1000);
}

function event(
  restaurantId: string,
  name: string,
  task: string | null,
  hours: number,
): OnboardingEventRow {
  return { restaurantId, event: name, task, createdAt: hoursAfter(hours) };
}

describe('hoursToFirstReservation', () => {
  it('arrondit le délai en heures', () => {
    expect(hoursToFirstReservation(T0, hoursAfter(5))).toBe(5);
    expect(hoursToFirstReservation(T0, new Date(T0.getTime() + 90 * 60 * 1000))).toBe(2);
  });

  it('ignore une réservation antérieure à l’onboarding', () => {
    expect(hoursToFirstReservation(T0, hoursAfter(-3))).toBeNull();
  });
});

describe('aggregateOnboardingCohort', () => {
  it('renvoie un funnel vide sans événement', () => {
    const funnel = aggregateOnboardingCohort([], []);

    expect(funnel.restaurants).toBe(0);
    expect(funnel.totalEvents).toBe(0);
    expect(funnel.overallCompletionRate).toBe(0);
    expect(funnel.timeToFirstReservation).toEqual({
      measured: 0,
      pending: 0,
      medianHours: null,
      p90Hours: null,
    });
    expect(funnel.steps).toHaveLength(ONBOARDING_STEP_ORDER.length);
  });

  it('compte entrées, complétions, abandons et taux par étape', () => {
    const events = [
      event('r1', 'onboarding_step_started', 'restaurant', 0),
      event('r1', 'onboarding_step_completed', 'restaurant', 1),
      event('r2', 'onboarding_step_started', 'restaurant', 0),
      event('r2', 'onboarding_step_blocked', 'restaurant', 2),
      event('r3', 'onboarding_step_started', 'hours', 0),
      event('r3', 'onboarding_step_skipped', 'hours', 1),
    ];

    const funnel = aggregateOnboardingCohort(events, []);
    const restaurantStep = funnel.steps.find((step) => step.step === 'restaurant');
    const hoursStep = funnel.steps.find((step) => step.step === 'hours');

    expect(restaurantStep).toMatchObject({
      started: 2,
      completed: 1,
      skipped: 0,
      blocked: 1,
      abandoned: 1,
      completionRate: 50,
    });
    expect(hoursStep).toMatchObject({
      started: 1,
      completed: 0,
      skipped: 1,
      abandoned: 0,
      completionRate: 0,
    });
  });

  it('distingue les restaurants mesurés de ceux qui attendent encore', () => {
    const events = [
      event('r1', 'onboarding_step_started', 'restaurant', 0),
      event('r2', 'onboarding_step_started', 'restaurant', 0),
      event('r3', 'onboarding_step_started', 'restaurant', 0),
    ];
    const timelines: RestaurantTimeline[] = [
      { restaurantId: 'r1', firstReservationAt: hoursAfter(4) },
      { restaurantId: 'r2', firstReservationAt: hoursAfter(8) },
      { restaurantId: 'r3', firstReservationAt: null },
    ];

    const funnel = aggregateOnboardingCohort(events, timelines);

    expect(funnel.timeToFirstReservation).toEqual({
      measured: 2,
      pending: 1,
      medianHours: 6,
      p90Hours: 8,
    });
  });

  it('ignore une timeline sans événement d’onboarding', () => {
    const events = [event('r1', 'onboarding_step_started', 'restaurant', 0)];
    const timelines: RestaurantTimeline[] = [
      { restaurantId: 'r1', firstReservationAt: hoursAfter(2) },
      { restaurantId: 'sans-onboarding', firstReservationAt: hoursAfter(2) },
    ];

    const funnel = aggregateOnboardingCohort(events, timelines);

    expect(funnel.restaurants).toBe(1);
    expect(funnel.timeToFirstReservation.measured).toBe(1);
  });

  it('compte les jalons globaux et le taux de complétion d’ensemble', () => {
    const events = [
      event('r1', 'onboarding_step_started', 'restaurant', 0),
      event('r1', 'onboarding_step_completed', 'restaurant', 1),
      event('r1', 'onboarding_activated', null, 2),
      event('r1', 'onboarding_first_call', null, 3),
      event('r2', 'onboarding_demo_call_played', null, 1),
    ];

    const funnel = aggregateOnboardingCohort(events, []);

    expect(funnel.milestones).toEqual({ activated: 1, firstCall: 1, demoCallPlayed: 1 });
    expect(funnel.overallCompletionRate).toBe(10);
  });
});

describe('perRestaurantProgress', () => {
  it('trie du plus bloquant au plus avancé', () => {
    const events = [
      event('bloque', 'onboarding_step_started', 'restaurant', 0),
      event('bloque', 'onboarding_step_blocked', 'phone', 1),
      event('bloque', 'onboarding_step_blocked', 'calendar', 2),
      event('avance', 'onboarding_step_started', 'restaurant', 0),
      event('avance', 'onboarding_step_completed', 'restaurant', 1),
      event('avance', 'onboarding_step_completed', 'hours', 2),
    ];
    const timelines: RestaurantTimeline[] = [
      { restaurantId: 'avance', firstReservationAt: hoursAfter(3) },
      { restaurantId: 'bloque', firstReservationAt: null },
    ];

    const rows = perRestaurantProgress(events, timelines);

    expect(rows.map((row) => row.restaurantId)).toEqual(['avance', 'bloque']);
    expect(rows[0]).toMatchObject({
      completedSteps: 2,
      blockedSteps: 0,
      hoursToFirstReservation: 3,
    });
    expect(rows[1]).toMatchObject({ blockedSteps: 2, firstReservationAt: null });
    expect(rows[1]?.hoursToFirstReservation).toBeNull();
  });

  it('expose le début et le dernier événement', () => {
    const events = [
      event('r1', 'onboarding_step_started', 'restaurant', 5),
      event('r1', 'onboarding_step_completed', 'restaurant', 1),
    ];

    const [row] = perRestaurantProgress(events, []);

    expect(row?.startedAt).toEqual(hoursAfter(1));
    expect(row?.lastEventAt).toEqual(hoursAfter(5));
  });
});
