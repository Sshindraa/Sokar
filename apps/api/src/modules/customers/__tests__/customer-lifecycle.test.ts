import { describe, expect, it, vi } from 'vitest';
import {
  computeCustomerLifecycle,
  LIFECYCLE_THRESHOLDS,
  summarizeLifecycleReservations,
} from '../customer-lifecycle';

vi.mock('../../../shared/db/client', () => ({ db: {} }));

const now = new Date('2026-10-22T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
/** `count` visits, every `every` days, the latest `lastDaysAgo` days ago. */
const rhythm = (count: number, every: number, lastDaysAgo: number) =>
  Array.from({ length: count }, (_, index) => daysAgo(lastDaysAgo + index * every));

describe('computeCustomerLifecycle', () => {
  it('nouveau sans aucune visite', () => {
    expect(computeCustomerLifecycle([], now)).toEqual({
      status: 'new',
      reason: 'Aucune visite pour l’instant',
    });
  });

  it('nouveau après une seule visite récente', () => {
    expect(computeCustomerLifecycle([daysAgo(10)], now)).toEqual({
      status: 'new',
      reason: 'Première visite il y a 10 jours',
    });
  });

  it('habitué à partir de 3 visites en 90 jours, pas à 2', () => {
    const t = LIFECYCLE_THRESHOLDS;
    expect(computeCustomerLifecycle(rhythm(t.regularMinVisits, 20, 5), now)).toEqual({
      status: 'regular',
      reason: '3 visites en 90 jours',
    });
    expect(computeCustomerLifecycle(rhythm(t.regularMinVisits - 1, 20, 5), now).status).toBe(
      'active',
    );
  });

  it('une visite juste hors de la fenêtre de 90 jours ne compte plus', () => {
    expect(computeCustomerLifecycle([daysAgo(5), daysAgo(30), daysAgo(91)], now).status).toBe(
      'active',
    );
    expect(computeCustomerLifecycle([daysAgo(5), daysAgo(30), daysAgo(89)], now).status).toBe(
      'regular',
    );
  });

  it('à risque quand un client mensuel ne revient plus (écart > 2 rythmes et > 45 j)', () => {
    expect(computeCustomerLifecycle(rhythm(6, 30, 70), now)).toEqual({
      status: 'at_risk',
      reason: 'Dernière visite il y a 2 mois, venait tous les mois',
    });
  });

  it('pas à risque sous le minimum de 45 jours, même pour un client hebdomadaire', () => {
    expect(computeCustomerLifecycle(rhythm(6, 7, 45), now).status).not.toBe('at_risk');
    expect(computeCustomerLifecycle(rhythm(6, 7, 46), now)).toEqual({
      status: 'at_risk',
      reason: 'Dernière visite il y a 6 semaines, venait chaque semaine',
    });
  });

  it('pas de rythme avec moins de 3 visites : jamais à risque', () => {
    expect(computeCustomerLifecycle([daysAgo(100), daysAgo(110)], now).status).toBe('active');
  });

  it('endormi au-delà de 180 jours, avec le rythme passé', () => {
    expect(computeCustomerLifecycle(rhythm(5, 30, 180), now).status).toBe('at_risk');
    expect(computeCustomerLifecycle(rhythm(5, 30, 181), now)).toEqual({
      status: 'dormant',
      reason: 'Dernière visite il y a 6 mois, venait tous les mois',
    });
    expect(computeCustomerLifecycle([daysAgo(200)], now)).toEqual({
      status: 'dormant',
      reason: 'Dernière visite il y a 6 mois',
    });
  });

  it('ignore les dates futures', () => {
    expect(computeCustomerLifecycle([new Date(now.getTime() + DAY)], now).status).toBe('new');
  });
});

describe('summarizeLifecycleReservations', () => {
  const reservation = (state: string, days: number, status = state) => ({
    state,
    status,
    startsAt: daysAgo(days),
    reservedAt: daysAgo(days),
  });

  it('compte les vraies visites et les absences récentes, pas les annulations ni le futur', () => {
    const stats = summarizeLifecycleReservations(
      [
        reservation('HONORED', 10),
        reservation('SEATED', 20),
        reservation('CONFIRMED', 30),
        reservation('CONFIRMED', 40, 'CANCELLED'),
        reservation('CANCELLED', 50),
        reservation('NO_SHOW', 60),
        reservation('CONFIRMED', 70, 'NO_SHOW'),
        reservation('NO_SHOW', 400),
        reservation('CONFIRMED', -5),
      ],
      now,
    );
    expect(stats.visitDates.map((date) => date.toISOString())).toEqual([
      daysAgo(30).toISOString(),
      daysAgo(20).toISOString(),
      daysAgo(10).toISOString(),
    ]);
    expect(stats.noShows365d).toBe(2);
  });
});
