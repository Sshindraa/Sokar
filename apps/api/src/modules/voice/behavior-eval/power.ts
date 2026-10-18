import { BEHAVIOR_FAMILIES, type BehaviorCase, type BehaviorFamily } from './types';

/**
 * Dimensionnement du banc : « fiable » veut dire voir une baisse de 20 points par famille de comportements.
 * Test unilatéral à 5 %, puissance 80 %, approximation normale de deux proportions indépendantes. C'est
 * prudent : les deux bras rejouent les mêmes cas, ce qui retire la variance entre cas mais pas le bruit des
 * tirages d'un même cas.
 */
export const TARGET_DROP = 0.2;
const Z_ALPHA = 1.645;
const Z_POWER = 0.8416;
/** Défauts réels (ou variantes de défauts réels) exigés par famille, pour ne pas juger sur un seul cas. */
export const MIN_DEFECTS_PER_FAMILY = 4;
/** Taux de départ le plus défavorable (variance maximale) quand on ne connaît pas encore la référence. */
export const WORST_CASE_RATE = 0.5;

/** Tirages par bras pour distinguer `baseline` de `baseline - drop`. */
export function requiredDrawsPerArm(baseline: number, drop: number = TARGET_DROP): number {
  const low = Math.max(0, baseline - drop);
  const mean = (baseline + low) / 2;
  const numerator =
    Z_ALPHA * Math.sqrt(2 * mean * (1 - mean)) +
    Z_POWER * Math.sqrt(baseline * (1 - baseline) + low * (1 - low));
  return Math.ceil((numerator * numerator) / (drop * drop));
}

/** Tirages par famille et par bras qui suffisent à voir TARGET_DROP même au pire taux de départ. */
export const FAMILY_DRAWS = requiredDrawsPerArm(WORST_CASE_RATE);

/** Plus petite baisse vue avec `draws` tirages par bras, à partir d'un taux de référence. */
export function detectableDrop(baseline: number, draws: number): number {
  for (let drop = 0.01; drop <= baseline + 1e-9; drop += 0.01) {
    if (requiredDrawsPerArm(baseline, drop) <= draws) return Math.round(drop * 100) / 100;
  }
  return baseline;
}

/** Un défaut compte s'il est réel ou variante d'un défaut réel, et que ce que l'appelant a dit est établi. */
export function isDefect(testCase: BehaviorCase): boolean {
  return testCase.origin !== 'control' && testCase.truthStatus !== 'unverified';
}

export interface FamilyCoverage {
  family: BehaviorFamily;
  cases: number;
  /** Défauts réels et variantes de défauts réels (les témoins n'y comptent pas). */
  defects: number;
  real: number;
  variants: number;
  controls: number;
  engineCases: number;
  draws: number;
  /** Baisse détectable au pire taux de départ (50 %). */
  detectableDrop: number;
  /** Quatre défauts au moins ET assez de tirages pour voir TARGET_DROP au pire taux. */
  sized: boolean;
}

/**
 * Tirages par cas pour atteindre `drawsPerFamily` dans chaque famille : répartis à parts égales, arrondis
 * au-dessus. Remplace les `samples` écrits à la main, qui ne dimensionnaient rien.
 */
export function allocateDraws(cases: BehaviorCase[], drawsPerFamily: number): Map<string, number> {
  const counts = new Map<BehaviorFamily, number>();
  for (const testCase of cases) counts.set(testCase.family, (counts.get(testCase.family) ?? 0) + 1);
  return new Map(
    cases.map((testCase) => [
      testCase.id,
      Math.ceil(drawsPerFamily / (counts.get(testCase.family) ?? 1)),
    ]),
  );
}

export function familyCoverage(
  cases: BehaviorCase[],
  drawsOfCase: (testCase: BehaviorCase) => number = (testCase) => testCase.samples ?? 12,
): FamilyCoverage[] {
  return BEHAVIOR_FAMILIES.map((family) => {
    const own = cases.filter((testCase) => testCase.family === family);
    const real = own.filter((c) => c.origin === 'real' && isDefect(c)).length;
    const variants = own.filter((c) => c.origin === 'variant' && isDefect(c)).length;
    const draws = own.reduce((sum, testCase) => sum + drawsOfCase(testCase), 0);
    const drop = detectableDrop(WORST_CASE_RATE, draws);
    return {
      family,
      cases: own.length,
      defects: real + variants,
      real,
      variants,
      controls: own.length - real - variants,
      engineCases: own.filter((testCase) => testCase.measures === 'engine').length,
      draws,
      detectableDrop: drop,
      sized: real + variants >= MIN_DEFECTS_PER_FAMILY && drop <= TARGET_DROP + 1e-9,
    };
  });
}

export function formatCoverage(coverage: FamilyCoverage[]): string {
  const lines = [
    `Couverture par famille (objectif : voir une baisse de ${TARGET_DROP * 100} points, ≥ ${MIN_DEFECTS_PER_FAMILY} défauts) :`,
  ];
  for (const entry of coverage) {
    lines.push(
      `  ${entry.sized ? '✓' : '✗'} ${entry.family} : ${entry.cases} cas ` +
        `(${entry.real} réels, ${entry.variants} variantes, ${entry.controls} témoins ; ${entry.engineCases} mesurent le moteur), ` +
        `${entry.draws} tirages par bras, baisse détectable au pire taux : ${Math.round(entry.detectableDrop * 100)} points`,
    );
  }
  return lines.join('\n');
}
