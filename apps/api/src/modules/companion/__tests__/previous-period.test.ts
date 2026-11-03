import { describe, it, expect } from 'vitest';
import { previousPeriodOf } from '../query-data';

describe('previousPeriodOf : mois civil, mois en cours, semaine', () => {
  it('compare un mois civil complet au mois civil précédent', () => {
    expect(previousPeriodOf('2026-10-01', '2026-10-31')).toEqual(['2026-09-01', '2026-09-30']);
    expect(previousPeriodOf('2026-03-01', '2026-03-31')).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('borne un mois de 31 jours à un mois précédent de 30 jours (31 → 30)', () => {
    expect(previousPeriodOf('2026-10-01', '2026-10-31')[1]).toBe('2026-09-30');
  });

  it('compare février complet au mois de janvier complet, et février bissextile', () => {
    expect(previousPeriodOf('2026-02-01', '2026-02-28')).toEqual(['2026-01-01', '2026-01-31']);
    expect(previousPeriodOf('2028-03-01', '2028-03-31')).toEqual(['2028-02-01', '2028-02-29']);
  });

  it('compare un mois en cours, du 1er à J, au même intervalle du mois précédent', () => {
    expect(previousPeriodOf('2026-10-01', '2026-10-15')).toEqual(['2026-09-01', '2026-09-15']);
  });

  it('borne le mois en cours à la fin du mois précédent', () => {
    // Mars jusqu'au 30 : février n'a que 28 jours.
    expect(previousPeriodOf('2026-03-01', '2026-03-30')).toEqual(['2026-02-01', '2026-02-28']);
  });

  it('compare une semaine lundi-dimanche à la semaine précédente', () => {
    expect(previousPeriodOf('2026-10-05', '2026-10-11')).toEqual(['2026-09-28', '2026-10-04']);
  });

  it('garde la même durée juste avant pour les autres périodes', () => {
    expect(previousPeriodOf('2026-10-06', '2026-10-08')).toEqual(['2026-10-03', '2026-10-05']);
    expect(previousPeriodOf('2026-09-15', '2026-10-10')).toEqual(['2026-08-20', '2026-09-14']);
  });

  it('garde la veille pour un seul jour, même le 1er', () => {
    expect(previousPeriodOf('2026-10-06', '2026-10-06')).toEqual(['2026-10-05', '2026-10-05']);
    expect(previousPeriodOf('2026-10-01', '2026-10-01')).toEqual(['2026-09-30', '2026-09-30']);
  });
});
