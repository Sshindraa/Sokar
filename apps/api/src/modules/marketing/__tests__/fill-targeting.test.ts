import { describe, expect, it } from 'vitest';

import {
  countByTier,
  selectFillAudience,
  tierOf,
  type FillTier,
  type VisitStats,
} from '../fill-targeting';

const NOW = new Date('2026-11-02T10:00:00Z');
const DAY_MS = 24 * 3600_000;
const ago = (days: number) => NOW.getTime() - days * DAY_MS;

const stats = (over: Partial<VisitStats> = {}): VisitStats => ({
  slotVisits: 0,
  visits: 0,
  lastSlotAt: 0,
  lastAt: 0,
  ...over,
});

type Cand = { id: string; tier: FillTier; stats: VisitStats };
const cand = (id: string, tier: FillTier, over: Partial<VisitStats> = {}): Cand => ({
  id,
  tier,
  stats: stats(over),
});
const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    cand(`c${i}`, 'CRENEAU', { slotVisits: 2, visits: 2, lastSlotAt: ago(10), lastAt: ago(10) }),
  );

const base = { groupSize: 1, holdoutRate: 0.3, maxSends: 1000 };

describe('tierOf', () => {
  it('CRENEAU : 2 visites sur le créneau, la dernière à 119 j', () => {
    const s = stats({ slotVisits: 2, visits: 2, lastSlotAt: ago(119), lastAt: ago(119) });
    expect(tierOf(s, NOW)).toBe('CRENEAU');
  });

  it('CRENEAU : à 120 j, ce n’est plus CRENEAU', () => {
    const s = stats({ slotVisits: 2, visits: 2, lastSlotAt: ago(120), lastAt: ago(120) });
    expect(tierOf(s, NOW)).toBe('CONNU');
  });

  it('REGULIER : 3 visites, la dernière à 179 j', () => {
    expect(tierOf(stats({ visits: 3, lastAt: ago(179) }), NOW)).toBe('REGULIER');
  });

  it('REGULIER : à 180 j, CONNU', () => {
    expect(tierOf(stats({ visits: 3, lastAt: ago(180) }), NOW)).toBe('CONNU');
  });

  it('un client venu 20 fois le vendredi est REGULIER pour un mercredi, pas SANS_VISITE', () => {
    expect(tierOf(stats({ visits: 20, lastAt: ago(10) }), NOW)).toBe('REGULIER');
  });

  it('aucune visite → SANS_VISITE', () => {
    expect(tierOf(stats(), NOW)).toBe('SANS_VISITE');
  });
});

describe('selectFillAudience', () => {
  it('écarte SANS_VISITE (0,03 < 0,05), même si l’objectif n’est pas atteint', () => {
    const candidates = [cand('a', 'SANS_VISITE'), cand('ok', 'CRENEAU'), cand('b', 'SANS_VISITE')];
    const r = selectFillAudience({ ...base, candidates, emptyPlaces: 100 });
    expect(r.map((c) => c.id)).toEqual(['ok']);
  });

  it('tri : palier, puis visites sur le créneau, puis récence', () => {
    const crAncien = cand('crAncien', 'CRENEAU', {
      slotVisits: 2,
      visits: 2,
      lastSlotAt: ago(30),
      lastAt: ago(30),
    });
    const crRecent = cand('crRecent', 'CRENEAU', {
      slotVisits: 2,
      visits: 2,
      lastSlotAt: ago(5),
      lastAt: ago(5),
    });
    const crPlus = cand('crPlus', 'CRENEAU', {
      slotVisits: 3,
      visits: 3,
      lastSlotAt: ago(90),
      lastAt: ago(90),
    });
    const reg = cand('reg', 'REGULIER', {
      slotVisits: 2,
      visits: 5,
      lastSlotAt: ago(150),
      lastAt: ago(1),
    });
    const connu = cand('connu', 'CONNU', { visits: 1, lastAt: ago(1) });
    const candidates = [connu, crAncien, reg, crRecent, crPlus];
    const r = selectFillAudience({ ...base, candidates, emptyPlaces: 1000 });
    expect(r.map((c) => c.id)).toEqual(['crPlus', 'crRecent', 'crAncien', 'reg', 'connu']);
  });

  it('s’arrête à l’objectif : 3 places vides, groupe 2, témoin 0,3, CRENEAU → 8 clients', () => {
    const args = { candidates: many(20), emptyPlaces: 3, groupSize: 2, holdoutRate: 0.3 };
    expect(selectFillAudience({ ...args, maxSends: 1000 })).toHaveLength(8);
  });

  it('vivier insuffisant : renvoie tous les éligibles', () => {
    const candidates = [...many(3), cand('sans', 'SANS_VISITE')];
    const r = selectFillAudience({ ...base, candidates, emptyPlaces: 100 });
    expect(r.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
  });

  it('plafond : maxSends 40, témoin 0,3 → 57 clients, envois = 57 − round(17,1) = 40', () => {
    const args = { candidates: many(100), emptyPlaces: 1000, groupSize: 1, holdoutRate: 0.3 };
    const r = selectFillAudience({ ...args, maxSends: 40 });
    expect(r).toHaveLength(57);
    expect(r.length - Math.round(r.length * 0.3)).toBe(40);
  });

  it('maxSends 0 ou emptyPlaces 0 → liste vide', () => {
    const candidates = many(5);
    expect(selectFillAudience({ ...base, candidates, emptyPlaces: 100, maxSends: 0 })).toEqual([]);
    expect(selectFillAudience({ ...base, candidates, emptyPlaces: 0 })).toEqual([]);
  });

  it('ne modifie pas la liste reçue', () => {
    const a = cand('a', 'CONNU', { visits: 1, lastAt: ago(1) });
    const b = cand('b', 'CRENEAU', { slotVisits: 2, visits: 2, lastSlotAt: ago(5), lastAt: 1 });
    const input = [a, b];
    selectFillAudience({ ...base, candidates: input, emptyPlaces: 1000 });
    expect(input).toEqual([a, b]);
  });
});

describe('countByTier', () => {
  it('compte les clients par palier', () => {
    expect(countByTier(['CRENEAU', 'CONNU', 'CRENEAU'])).toEqual({ CRENEAU: 2, CONNU: 1 });
  });
});
