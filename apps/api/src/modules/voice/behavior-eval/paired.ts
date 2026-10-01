import { detectableDrop, isDefect, MIN_DEFECTS_PER_FAMILY, TARGET_DROP } from './power';
import { drawSucceeds } from './score';
import {
  BEHAVIOR_FAMILIES,
  type BehaviorAbResponses,
  type BehaviorCase,
  type BehaviorFamily,
  type BehaviorResponses,
  type BehaviorMeasures,
} from './types';

/**
 * Comparaison A/B des deux bras d'UN SEUL rejeu : mêmes cas, requêtes alternées, même session. Il n'y a pas
 * de référence stockée à comparer à un nouveau tirage : un score d'hier n'a pas été tiré dans les mêmes
 * conditions (fournisseur, charge, heure) et un écart de quelques points peut venir de là.
 */
export interface ArmCount {
  successes: number;
  draws: number;
  invalid: number;
}

export interface CaseDelta {
  id: string;
  family: BehaviorFamily;
  origin: BehaviorCase['origin'];
  measures: BehaviorMeasures;
  reference: ArmCount;
  candidate: ArmCount;
  /** Candidat moins référence, en part de tirages réussis. */
  delta: number;
}

export type FamilyVerdict = 'baisse' | 'hausse' | 'non concluant';

export interface FamilyDelta {
  family: BehaviorFamily;
  /** `temoins` : les cas témoins de la famille, jugés à part (ils ne doivent pas baisser). */
  group: 'defauts' | 'temoins';
  cases: number;
  drawsPerArm: number;
  referenceRate: number;
  candidateRate: number;
  delta: number;
  /** Intervalle à 90 % de l'écart moyen entre cas (rééchantillonnage des cas puis des tirages). */
  low: number;
  high: number;
  verdict: FamilyVerdict;
  /** Assez de défauts et de tirages pour voir TARGET_DROP à ce taux de référence. */
  sized: boolean;
  detectable: number;
}

export interface AbReport {
  runId: string;
  model: string;
  provider: string;
  cases: CaseDelta[];
  families: FamilyDelta[];
}

const RESAMPLES = 2000;
export const AB_SEED = 20261002;

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countArm(testCase: BehaviorCase, samples: (Record<string, unknown> | null)[]): ArmCount {
  const valid = samples.filter((sample): sample is Record<string, unknown> => sample !== null);
  return {
    // Une réponse invalide (réseau, quota, format) est un échec du tirage : une dégradation se voit.
    successes: valid.filter((sample) => drawSucceeds(testCase, sample)).length,
    draws: samples.length,
    invalid: samples.length - valid.length,
  };
}

const rateOf = (arm: ArmCount): number => (arm.draws ? arm.successes / arm.draws : 0);

function binomial(random: () => number, draws: number, probability: number): number {
  let successes = 0;
  for (let index = 0; index < draws; index++) if (random() < probability) successes++;
  return successes;
}

export function compareArms(cases: BehaviorCase[], ab: BehaviorAbResponses): AbReport {
  if (!ab.runId || !ab.arms?.reference || !ab.arms?.candidate) {
    throw new Error(
      'Rejeu A/B attendu : un fichier unique avec runId, arms.reference et arms.candidate. ' +
        'Comparer un nouveau tirage à une référence stockée est refusé.',
    );
  }
  const deltas: CaseDelta[] = [];
  for (const testCase of cases) {
    const reference = ab.arms.reference.responses[testCase.id];
    const candidate = ab.arms.candidate.responses[testCase.id];
    if (!reference?.length || !candidate?.length) continue;
    const referenceCount = countArm(testCase, reference);
    const candidateCount = countArm(testCase, candidate);
    deltas.push({
      id: testCase.id,
      family: testCase.family,
      origin: testCase.origin,
      measures: testCase.measures,
      reference: referenceCount,
      candidate: candidateCount,
      delta: rateOf(candidateCount) - rateOf(referenceCount),
    });
  }

  const random = prng(AB_SEED);
  const families: FamilyDelta[] = [];
  for (const [family, group] of BEHAVIOR_FAMILIES.flatMap((name) => [
    [name, 'defauts'] as const,
    [name, 'temoins'] as const,
  ])) {
    const own = deltas.filter(
      (entry) => entry.family === family && (entry.origin === 'control') === (group === 'temoins'),
    );
    if (!own.length) continue;
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const referenceRate = mean(own.map((entry) => rateOf(entry.reference)));
    const candidateRate = mean(own.map((entry) => rateOf(entry.candidate)));
    const draws = own.reduce((sum, entry) => sum + entry.reference.draws, 0);

    const samples: number[] = [];
    for (let round = 0; round < RESAMPLES; round++) {
      const picked = own.map(() => own[Math.floor(random() * own.length)]);
      samples.push(
        mean(
          picked.map(
            (entry) =>
              binomial(random, entry.candidate.draws, rateOf(entry.candidate)) /
                entry.candidate.draws -
              binomial(random, entry.reference.draws, rateOf(entry.reference)) /
                entry.reference.draws,
          ),
        ),
      );
    }
    samples.sort((a, b) => a - b);
    const low = samples[Math.floor(0.05 * (RESAMPLES - 1))];
    const high = samples[Math.ceil(0.95 * (RESAMPLES - 1))];
    const detectable = detectableDrop(Math.min(0.95, Math.max(0.05, referenceRate)), draws);
    // Défauts réellement rejoués dans cette famille (pas ceux du fichier) : un rejeu restreint ne conclut pas.
    const defects = cases.filter(
      (c) => isDefect(c) && own.some((entry) => entry.id === c.id),
    ).length;
    families.push({
      family,
      group,
      cases: own.length,
      drawsPerArm: draws,
      referenceRate,
      candidateRate,
      delta: candidateRate - referenceRate,
      low,
      high,
      verdict: high < 0 ? 'baisse' : low > 0 ? 'hausse' : 'non concluant',
      // Sous 20 % au départ, une baisse de 20 points n'existe pas : le banc ne peut rien dire.
      sized:
        (group === 'temoins' || defects >= MIN_DEFECTS_PER_FAMILY) &&
        referenceRate >= TARGET_DROP &&
        detectable <= TARGET_DROP + 1e-9,
      detectable,
    });
  }
  return {
    runId: ab.runId,
    model: ab.model,
    provider: ab.provider,
    cases: deltas,
    families,
  };
}

const points = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value * 100).toFixed(0)}`;

export function formatAbReport(report: AbReport): string {
  const lines = [
    `Rejeu A/B ${report.runId} : ${report.model} (${report.provider}), bras alternés dans la même session`,
    '',
    'Par famille (écart candidat − référence, intervalle à 90 %) :',
  ];
  for (const family of report.families) {
    const verdict =
      family.verdict === 'non concluant'
        ? family.sized
          ? `aucune baisse détectée (on verrait ≥ ${Math.round(family.detectable * 100)} points)`
          : family.referenceRate < TARGET_DROP
            ? 'NON CONCLUANT : référence sous 20 %, une baisse de 20 points est impossible à voir'
            : `NON CONCLUANT : sous-dimensionnée (on ne verrait que ≥ ${Math.round(family.detectable * 100)} points)`
        : family.verdict.toUpperCase();
    lines.push(
      `  ${family.family}${family.group === 'temoins' ? ' (témoins)' : ''} : ${(family.referenceRate * 100).toFixed(0)} % → ${(family.candidateRate * 100).toFixed(0)} % ` +
        `(${points(family.delta)} points, [${points(family.low)} ; ${points(family.high)}]), ` +
        `${family.cases} cas, ${family.drawsPerArm} tirages par bras : ${verdict}`,
    );
  }
  lines.push('', 'Par cas (mêmes cas dans les deux bras) :');
  for (const entry of report.cases) {
    const invalid =
      entry.reference.invalid || entry.candidate.invalid
        ? ` (invalides : ${entry.reference.invalid} / ${entry.candidate.invalid})`
        : '';
    lines.push(
      `  ${entry.id} [${entry.family}, ${entry.measures === 'engine' ? 'moteur' : 'modèle'}] : ` +
        `${entry.reference.successes}/${entry.reference.draws} → ${entry.candidate.successes}/${entry.candidate.draws} ` +
        `(${points(entry.delta)} points)${invalid}`,
    );
  }
  return lines.join('\n');
}

export interface ProviderGap {
  id: string;
  family: BehaviorFamily;
  measures: BehaviorMeasures;
  production: ArmCount;
  other: ArmCount;
  /** Autre fournisseur moins production, en part de tirages réussis. */
  delta: number;
  /** Écart d'au moins GROSS_GAP : seul ce que 12 tirages par cas peuvent voir. */
  gross: boolean;
}

/** Avec ~12 tirages par cas, un écart sous 30 points est du bruit : seul un écart grossier est un signal. */
export const GROSS_GAP = 0.3;

/**
 * Calage entre deux fournisseurs (production et un autre, deux rejeux séparés) sur les mêmes cas : ce n'est pas un
 * test de régression mais la question « peut-on explorer sur l'autre ? ». Verdict honnête : « pas d'écart grossier »,
 * jamais « équivalent ».
 */
export function compareProviders(
  cases: BehaviorCase[],
  production: BehaviorResponses,
  other: BehaviorResponses,
): ProviderGap[] {
  const gaps: ProviderGap[] = [];
  for (const testCase of cases) {
    const a = production.responses[testCase.id];
    const b = other.responses[testCase.id];
    if (!a?.length || !b?.length) continue;
    const productionCount = countArm(testCase, a);
    const otherCount = countArm(testCase, b);
    const delta = rateOf(otherCount) - rateOf(productionCount);
    gaps.push({
      id: testCase.id,
      family: testCase.family,
      measures: testCase.measures,
      production: productionCount,
      other: otherCount,
      delta,
      gross: Math.abs(delta) >= GROSS_GAP,
    });
  }
  return gaps;
}

export function formatProviderGaps(
  gaps: ProviderGap[],
  production: BehaviorResponses,
  other: BehaviorResponses,
): string {
  const lines = [
    `Calage : production ${production.model} contre ${other.model} (deux rejeux séparés, mêmes cas)`,
    '',
  ];
  for (const gap of gaps) {
    lines.push(
      `  ${gap.gross ? '⚠' : ' '} ${gap.id} [${gap.family}, ${gap.measures === 'engine' ? 'moteur' : 'modèle'}] : ` +
        `${gap.production.successes}/${gap.production.draws} → ${gap.other.successes}/${gap.other.draws} ` +
        `(${points(gap.delta)} points)`,
    );
  }
  const gross = gaps.filter((gap) => gap.gross).length;
  lines.push(
    '',
    gross
      ? `${gross} cas sur ${gaps.length} avec un écart d'au moins ${GROSS_GAP * 100} points : l'autre fournisseur ne reproduit pas la production sur ces cas.`
      : `Aucun écart grossier (≥ ${GROSS_GAP * 100} points) sur ${gaps.length} cas. Cela ne dit pas « équivalent » : 12 tirages par cas ne voient pas moins.`,
  );
  const usage = (name: string, responses: BehaviorResponses) =>
    responses.usage
      ? `${name} : ${responses.usage.promptTokens} tokens en entrée, ${responses.usage.completionTokens} en sortie (${responses.usage.requests} requêtes)`
      : `${name} : jetons non relevés`;
  lines.push(usage('Production', production), usage('Autre', other));
  return lines.join('\n');
}
