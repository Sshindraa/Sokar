/**
 * Jeu de test de comportements du tour structuré (voir src/modules/voice/behavior-eval).
 *
 *   [VBE_UNDERSTANDING=1] tsx scripts/voice-behavior-eval.ts build [--suite default|perturb|all] [cas.json]   > requests.json
 *   tsx scripts/voice-behavior-eval.ts score [--suite …] [--json] [cas.json] responses.json
 *   VBE_ONLY=… tsx scripts/voice-behavior-eval.ts build --judge [--case-draws N] [cas.json]   (prototype : juge de fin de tour séparé, voir behavior-eval/judge.ts)
 *   tsx scripts/voice-behavior-eval.ts score --judge [cas.json] responses.json   (cas `turnComplete` seulement, noté sur ce seul contrôle)
 *   tsx scripts/voice-behavior-eval.ts coverage [--family-draws N|auto] [cas.json]
 *   tsx scripts/voice-behavior-eval.ts ab [cas.json] ab-responses.json
 *   tsx scripts/voice-behavior-eval.ts calibrate [cas.json] production.json autre.json
 *
 * `build` compose les vraies requêtes du prompt courant ; le rejeu contre le modèle
 * est fait par voice-behavior-replay.mjs (sur le serveur, où sont les clés) ; `score`
 * compare aux seuils et sort en erreur si un comportement n'est plus tenu. La suite
 * `perturb` (variantes dégradées générées, informatives) est décrite dans
 * docs/runbooks/testing.md. `--family-draws N` répartit N tirages par famille entre ses cas
 * (au lieu des `samples` écrits dans le fichier). `coverage` dit, par famille, si le banc est
 * dimensionné pour voir une baisse de 20 points. `ab` note un rejeu A/B (référence et candidat tirés
 * dans la même session, requêtes alternées) cas par cas puis par famille : il n'existe pas de
 * comparaison à une référence stockée.
 * Enchaînement complet : scripts/ops/voice-behavior-eval.sh (un bras), scripts/ops/voice-behavior-ab.sh (deux bras).
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRequests } from '../src/modules/voice/behavior-eval/build';
import {
  buildJudgeRequests,
  isJudgeCase,
  judgeAsTurn,
  turnCompleteOnly,
} from '../src/modules/voice/behavior-eval/judge';
import {
  casesForSuite,
  PERTURB_SEED,
  type BehaviorSuite,
} from '../src/modules/voice/behavior-eval/perturb';
import {
  allocateDraws,
  FAMILY_DRAWS,
  familyCoverage,
  formatCoverage,
} from '../src/modules/voice/behavior-eval/power';
import {
  compareArms,
  compareProviders,
  formatAbReport,
  formatProviderGaps,
} from '../src/modules/voice/behavior-eval/paired';
import {
  formatReport,
  formatSummary,
  scoreAll,
  summarize,
} from '../src/modules/voice/behavior-eval/score';
import type {
  BehaviorAbResponses,
  BehaviorCase,
  BehaviorCasesFile,
  BehaviorResponses,
  BehaviorSummary,
  CaseResult,
} from '../src/modules/voice/behavior-eval/types';

const DEFAULT_CASES = path.join(__dirname, 'fixtures/voice-behavior/cases.json');
const SUITES: BehaviorSuite[] = ['default', 'perturb', 'all'];

interface RunFile {
  model: string;
  suite: BehaviorSuite;
  seed: number;
  results: CaseResult[];
  summary: BehaviorSummary;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** Sépare les options (--suite x, --json) des arguments positionnels. */
function parseArgs(args: string[]): {
  positional: string[];
  suite: BehaviorSuite;
  json: boolean;
  familyDraws?: number;
  caseDraws?: number;
  judge: boolean;
} {
  const positional: string[] = [];
  let suite: BehaviorSuite = 'default';
  let json = false;
  let familyDraws: number | undefined;
  let caseDraws: number | undefined;
  let judge = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--judge') judge = true;
    else if (arg === '--family-draws') {
      // `auto` : de quoi voir une baisse de 20 points au pire taux de départ (voir power.ts).
      const value = args[++index];
      familyDraws = value === 'auto' ? FAMILY_DRAWS : Number(value);
      if (!Number.isInteger(familyDraws) || familyDraws < 1)
        throw new Error('--family-draws attend un entier positif ou « auto »');
    } else if (arg === '--case-draws') {
      caseDraws = Number(args[++index]);
      if (!Number.isInteger(caseDraws) || caseDraws < 1)
        throw new Error('--case-draws attend un entier positif');
    } else if (arg === '--suite') {
      const value = args[++index] as BehaviorSuite;
      if (!SUITES.includes(value))
        throw new Error(`Suite inconnue « ${value} » (${SUITES.join(', ')})`);
      suite = value;
    } else positional.push(arg);
  }
  return { positional, suite, json, familyDraws, caseDraws, judge };
}

function selectedCases(file: BehaviorCasesFile, suite: BehaviorSuite) {
  const cases = casesForSuite(file, suite);
  // VBE_ONLY=id1,id2 : rejoue quelques cas seulement (le jeu complet dépasse le débit Cerebras).
  const only = process.env.VBE_ONLY?.split(',').filter(Boolean);
  return only?.length ? cases.filter((testCase) => only.includes(testCase.id)) : cases;
}

/** Tirages par cas : ceux du fichier, ou répartis pour atteindre `familyDraws` par famille. */
function withFamilyDraws(cases: BehaviorCase[], familyDraws?: number): BehaviorCase[] {
  if (!familyDraws) return cases;
  const draws = allocateDraws(cases, familyDraws);
  return cases.map((testCase) => ({ ...testCase, samples: draws.get(testCase.id) }));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, suite, json, familyDraws, caseDraws, judge } = parseArgs(rest);
  if (command === 'coverage') {
    const file = await readJson<BehaviorCasesFile>(positional[0] ?? DEFAULT_CASES);
    const cases = withFamilyDraws(selectedCases(file, 'default'), familyDraws);
    const total = cases.reduce((sum, testCase) => sum + (testCase.samples ?? 12), 0);
    process.stdout.write(
      `${formatCoverage(familyCoverage(cases))}\n\n${total} tirages par bras.\n`,
    );
    return;
  }
  if (command === 'calibrate') {
    const [casesArg, productionArg, otherArg] =
      positional.length > 2 ? positional : [DEFAULT_CASES, positional[0], positional[1]];
    if (!productionArg || !otherArg)
      throw new Error('Usage : calibrate [cas.json] production.json autre.json');
    const file = await readJson<BehaviorCasesFile>(casesArg);
    const [production, other] = await Promise.all([
      readJson<BehaviorResponses>(productionArg),
      readJson<BehaviorResponses>(otherArg),
    ]);
    const gaps = compareProviders(selectedCases(file, 'default'), production, other);
    process.stdout.write(`${formatProviderGaps(gaps, production, other)}\n`);
    return;
  }
  if (command === 'ab') {
    const [casesArg, responsesArg] =
      positional.length > 1 ? positional : [DEFAULT_CASES, positional[0]];
    if (!responsesArg) throw new Error('Usage : ab [cas.json] ab-responses.json');
    const file = await readJson<BehaviorCasesFile>(casesArg);
    const ab = await readJson<BehaviorAbResponses>(responsesArg);
    process.stdout.write(`${formatAbReport(compareArms(selectedCases(file, 'default'), ab))}\n`);
    return;
  }
  if (command === 'build') {
    const file = await readJson<BehaviorCasesFile>(positional[0] ?? DEFAULT_CASES);
    if (judge) {
      // Prototype : requêtes minimales du juge de fin de tour, mêmes cas (famille « attente » et ses témoins).
      file.cases = selectedCases(file, 'default').filter(isJudgeCase);
      process.stdout.write(JSON.stringify({ requests: buildJudgeRequests(file, caseDraws) }));
      return;
    }
    // `--case-draws N` : N tirages pour chaque cas retenu (sonde, calage) ; sinon la répartition par famille.
    file.cases = caseDraws
      ? selectedCases(file, suite).map((testCase) => ({ ...testCase, samples: caseDraws }))
      : withFamilyDraws(selectedCases(file, suite), familyDraws);
    // VBE_UNDERSTANDING=1 : requêtes avec la vérification de compréhension (drapeau de production).
    const understanding = process.env.VBE_UNDERSTANDING === '1';
    process.stdout.write(JSON.stringify({ requests: buildRequests(file, { understanding }) }));
    return;
  }
  if (command === 'score') {
    const [casesArg, responsesArg] =
      positional.length > 1 ? positional : [DEFAULT_CASES, positional[0]];
    if (!responsesArg)
      throw new Error('Usage : score [--suite …] [--json] [cas.json] responses.json');
    const file = await readJson<BehaviorCasesFile>(casesArg);
    const raw = await readJson<BehaviorResponses>(responsesArg);
    // `--judge` : sorties `{ complete }` du juge, notées sur le seul contrôle `turnComplete` de chaque cas.
    const responses = judge ? judgeAsTurn(raw) : raw;
    const scored = selectedCases(file, suite);
    const results = scoreAll(
      judge ? scored.filter(isJudgeCase).map(turnCompleteOnly) : scored,
      responses,
    );
    const summary = summarize(results);
    if (json) {
      const run: RunFile = { model: responses.model, suite, seed: PERTURB_SEED, results, summary };
      process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Modèle : ${responses.model}\n\n${formatReport(results)}\n\n${formatSummary(summary)}\n`,
      );
    }
    if (results.some((result) => !result.informational && !result.passed)) process.exitCode = 1;
    return;
  }
  throw new Error(
    'Usage : build [--suite …] [--family-draws N|auto] [--case-draws N] [cas.json] | score [--suite …] [--json] [cas.json] responses.json | coverage [--family-draws N|auto] [cas.json] | ab [cas.json] ab-responses.json | calibrate [cas.json] production.json autre.json',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
