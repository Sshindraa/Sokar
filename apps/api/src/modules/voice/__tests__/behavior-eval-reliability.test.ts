import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { compareArms, formatAbReport } from '../behavior-eval/paired';
import {
  allocateDraws,
  detectableDrop,
  FAMILY_DRAWS,
  familyCoverage,
  MIN_DEFECTS_PER_FAMILY,
  requiredDrawsPerArm,
  TARGET_DROP,
} from '../behavior-eval/power';
import { drawSucceeds, scoreCase } from '../behavior-eval/score';
import {
  BEHAVIOR_FAMILIES,
  type BehaviorAbResponses,
  type BehaviorCase,
  type BehaviorCasesFile,
} from '../behavior-eval/types';

const file = JSON.parse(
  readFileSync(
    path.join(__dirname, '../../../../scripts/fixtures/voice-behavior/cases.json'),
    'utf8',
  ),
) as BehaviorCasesFile;

/** Draft du modèle qui tient (ou non) un contrôle `draft.time`. */
const output = (time: string): Record<string, unknown> => ({
  say: 'ok',
  draft: { date: '', time, partySize: 0, customerName: '' },
});

const timeCase = (id: string, family: BehaviorCase['family'] = 'extraction'): BehaviorCase => ({
  id,
  behavior: 'test',
  family,
  measures: 'model',
  origin: 'real',
  source: 'test',
  history: [],
  transcript: 'à 19 heures',
  checks: [{ kind: 'draft', field: 'time', equals: '19:00', minRate: 0.5 }],
});

describe('dimensionnement : voir une baisse de 20 points', () => {
  it('au pire taux de départ (50 %), il faut de l’ordre de 70 à 80 tirages par bras', () => {
    const draws = requiredDrawsPerArm(0.5);
    expect(draws).toBeGreaterThanOrEqual(65);
    expect(draws).toBeLessThanOrEqual(80);
  });

  it('un taux de départ élevé demande moins de tirages, et plus de tirages voient une baisse plus petite', () => {
    expect(requiredDrawsPerArm(0.9)).toBeLessThan(requiredDrawsPerArm(0.5));
    expect(detectableDrop(0.5, 200)).toBeLessThan(detectableDrop(0.5, 40));
    expect(detectableDrop(0.5, requiredDrawsPerArm(0.5))).toBeCloseTo(TARGET_DROP, 1);
  });

  it('répartit les tirages d’une famille entre ses cas, en arrondissant au-dessus', () => {
    const cases = [timeCase('a'), timeCase('b'), timeCase('c')];
    const draws = allocateDraws(cases, 72);
    expect([...draws.values()]).toEqual([24, 24, 24]);
    expect(allocateDraws(cases, 50).get('a')).toBe(17);
  });
});

describe('jeu de cas : déclarations et couverture', () => {
  const cases = file.cases;
  const ids = new Set(cases.map((testCase) => testCase.id));

  it('chaque cas déclare sa famille, ce qu’il mesure et son origine', () => {
    for (const testCase of cases) {
      expect(BEHAVIOR_FAMILIES, testCase.id).toContain(testCase.family);
      expect(['model', 'engine'], testCase.id).toContain(testCase.measures);
      expect(['real', 'variant', 'control'], testCase.id).toContain(testCase.origin);
    }
  });

  it('un contrôle passé par le moteur (hangsUp) déclare mesurer le moteur', () => {
    for (const testCase of cases) {
      const usesEngine = testCase.checks.some(
        (check) =>
          check.kind === 'hangsUp' ||
          (check.kind === 'anyOf' && check.of.some((predicate) => predicate.kind === 'hangsUp')),
      );
      if (usesEngine) expect(testCase.measures, testCase.id).toBe('engine');
    }
  });

  it('une variante nomme un défaut réel documenté : un cas réel du jeu ou un appel', () => {
    for (const testCase of cases.filter((c) => c.origin === 'variant')) {
      expect(testCase.variantOf, testCase.id).toBeTruthy();
      const target = cases.find((c) => c.id === testCase.variantOf);
      if (target) expect(target.origin, testCase.id).toBe('real');
      else expect(testCase.variantOf, testCase.id).toMatch(/^appel [0-9a-f]{8}$/);
    }
    for (const testCase of cases.filter((c) => c.origin !== 'variant')) {
      expect(testCase.variantOf, testCase.id).toBeUndefined();
    }
    expect(ids.size).toBe(cases.length);
  });

  it(`chaque famille a ${MIN_DEFECTS_PER_FAMILY} défauts au moins et voit 20 points avec ${FAMILY_DRAWS} tirages par bras`, () => {
    const draws = allocateDraws(cases, FAMILY_DRAWS);
    const coverage = familyCoverage(cases, (testCase) => draws.get(testCase.id) ?? 0);
    for (const entry of coverage) {
      expect(entry.defects, entry.family).toBeGreaterThanOrEqual(MIN_DEFECTS_PER_FAMILY);
      expect(entry.detectableDrop, entry.family).toBeLessThanOrEqual(TARGET_DROP + 1e-9);
    }
  });

  it('la difficulté, quand elle est notée, est une information : aucun cas n’est écarté pour elle', () => {
    for (const testCase of cases) {
      if (testCase.difficulty) {
        expect(testCase.difficulty.rate).toBeGreaterThanOrEqual(0);
        expect(testCase.difficulty.rate).toBeLessThanOrEqual(1);
      }
    }
    expect(familyCoverage(cases).reduce((sum, entry) => sum + entry.cases, 0)).toBe(cases.length);
  });
});

describe('un cas mesure le modèle ou le moteur', () => {
  const spelled = (measures: 'model' | 'engine'): BehaviorCase => ({
    id: 'epele',
    behavior: 'test',
    family: 'epellation',
    measures,
    origin: 'real',
    source: 'test',
    history: [],
    transcript: 'e t',
    draft: { customerName: 'HOUT' },
    awaiting: 'customerNameConfirmation',
    checks: [{ kind: 'draft', field: 'customerName', equals: 'HOUET', minRate: 0.85 }],
  });
  // Le modèle recolle toute l'épellation au nom relu : le garde-fou du moteur la rattrape.
  const samples = [{ say: 'ok', draft: { customerName: 'HOUTET' } }];

  it('`model` : le chiffre est la sortie brute du modèle, le garde-fou est noté à côté', () => {
    const [check] = scoreCase(spelled('model'), samples).checks;
    expect(check.rate).toBe(0);
    expect(check.guardedRate).toBe(1);
    expect(check.rawRate).toBeUndefined();
  });

  it('`engine` : le chiffre est celui d’après les garde-fous, le brut du modèle est noté à côté', () => {
    const [check] = scoreCase(spelled('engine'), samples).checks;
    expect(check.rate).toBe(1);
    expect(check.rawRate).toBe(0);
    expect(check.guardedRate).toBeUndefined();
    expect(drawSucceeds(spelled('engine'), samples[0])).toBe(true);
    expect(drawSucceeds(spelled('model'), samples[0])).toBe(false);
  });
});

describe('comparaison A/B : un seul rejeu, jamais de référence stockée', () => {
  const cases = ['a', 'b', 'c', 'd'].map((id) => timeCase(id));
  const arm = (rateByCase: Record<string, number>, draws = 18) => ({
    model: 'test',
    responses: Object.fromEntries(
      cases.map((testCase) => [
        testCase.id,
        Array.from({ length: draws }, (_, index) =>
          output(index < Math.round(rateByCase[testCase.id] * draws) ? '19:00' : '20:00'),
        ),
      ]),
    ),
  });
  const run = (reference: Record<string, number>, candidate: Record<string, number>) =>
    ({
      runId: 'run-1',
      startedAt: '2026-10-02T00:00:00Z',
      model: 'test',
      provider: 'cerebras',
      served: {},
      arms: { reference: arm(reference), candidate: arm(candidate) },
    }) as BehaviorAbResponses;
  const flat = (rate: number) => ({ a: rate, b: rate, c: rate, d: rate });

  it('refuse un fichier sans les deux bras du même rejeu', () => {
    expect(() => compareArms(cases, { arms: {} } as never)).toThrow(/référence stockée/);
    expect(() =>
      compareArms(cases, { ...run(flat(1), flat(1)), runId: '' } as BehaviorAbResponses),
    ).toThrow(/référence stockée/);
  });

  it('deux bras identiques : aucun écart, aucune baisse annoncée', () => {
    const report = compareArms(cases, run(flat(0.8), flat(0.8)));
    expect(report.families[0].delta).toBe(0);
    expect(report.families[0].verdict).toBe('non concluant');
    expect(report.cases.map((entry) => entry.delta)).toEqual([0, 0, 0, 0]);
  });

  it('une baisse nette sur les mêmes cas est détectée, cas par cas puis pour la famille', () => {
    const report = compareArms(cases, run(flat(0.9), flat(0.5)));
    expect(report.cases.every((entry) => entry.delta < -0.3)).toBe(true);
    expect(report.families[0].verdict).toBe('baisse');
    expect(report.families[0].high).toBeLessThan(0);
    expect(formatAbReport(report)).toContain('BAISSE');
  });

  it('une hausse nette est signalée comme telle', () => {
    expect(compareArms(cases, run(flat(0.4), flat(0.9))).families[0].verdict).toBe('hausse');
  });

  it('une réponse invalide compte comme un tirage raté, pas comme un tirage absent', () => {
    const ab = run(flat(1), flat(1));
    ab.arms.candidate.responses.a = Array.from({ length: 18 }, () => null) as never;
    const report = compareArms(cases, ab);
    const first = report.cases.find((entry) => entry.id === 'a')!;
    expect(first.candidate).toEqual({ successes: 0, draws: 18, invalid: 18 });
    expect(first.delta).toBe(-1);
  });

  it('dit « sous-dimensionnée » quand la famille n’a pas assez de défauts ou de tirages', () => {
    const few = cases.slice(0, 2);
    const report = compareArms(few, run(flat(0.8), flat(0.8)));
    expect(report.families[0].sized).toBe(false);
    expect(formatAbReport(report)).toContain('sous-dimensionnée');
  });

  it('ne conclut rien quand la référence est sous 20 % : une baisse de 20 points n’existe pas', () => {
    const report = compareArms(cases, run(flat(0.1), flat(0.1)));
    expect(report.families[0].sized).toBe(false);
    expect(formatAbReport(report)).toContain('référence sous 20 %');
  });

  it('est déterministe : deux analyses du même rejeu donnent les mêmes intervalles', () => {
    const ab = run(flat(0.7), flat(0.6));
    expect(compareArms(cases, ab)).toEqual(compareArms(cases, ab));
  });
});
