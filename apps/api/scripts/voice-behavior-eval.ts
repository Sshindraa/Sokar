/**
 * Jeu de test de comportements du tour structuré (voir src/modules/voice/behavior-eval).
 *
 *   [VBE_UNDERSTANDING=1] tsx scripts/voice-behavior-eval.ts build [--suite default|perturb|all] [cas.json]   > requests.json
 *   tsx scripts/voice-behavior-eval.ts score [--suite …] [--json] [cas.json] responses.json
 *   tsx scripts/voice-behavior-eval.ts compare avant.json apres.json
 *
 * `build` compose les vraies requêtes du prompt courant ; le rejeu contre le modèle
 * est fait par voice-behavior-replay.mjs (sur le serveur, où sont les clés) ; `score`
 * compare aux seuils et sort en erreur si un comportement n'est plus tenu. La suite
 * `perturb` (variantes dégradées générées, informatives) est décrite dans
 * docs/runbooks/testing.md. `score --json` sort les résultats et les indicateurs pour
 * `compare`.
 * Enchaînement complet : scripts/ops/voice-behavior-eval.sh.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRequests } from '../src/modules/voice/behavior-eval/build';
import {
  casesForSuite,
  PERTURB_SEED,
  type BehaviorSuite,
} from '../src/modules/voice/behavior-eval/perturb';
import {
  compareRuns,
  formatReport,
  formatSummary,
  scoreAll,
  summarize,
} from '../src/modules/voice/behavior-eval/score';
import type {
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
function parseArgs(args: string[]): { positional: string[]; suite: BehaviorSuite; json: boolean } {
  const positional: string[] = [];
  let suite: BehaviorSuite = 'default';
  let json = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (arg === '--suite') {
      const value = args[++index] as BehaviorSuite;
      if (!SUITES.includes(value))
        throw new Error(`Suite inconnue « ${value} » (${SUITES.join(', ')})`);
      suite = value;
    } else positional.push(arg);
  }
  return { positional, suite, json };
}

function selectedCases(file: BehaviorCasesFile, suite: BehaviorSuite) {
  const cases = casesForSuite(file, suite);
  // VBE_ONLY=id1,id2 : rejoue quelques cas seulement (le jeu complet dépasse le débit Cerebras).
  const only = process.env.VBE_ONLY?.split(',').filter(Boolean);
  return only?.length ? cases.filter((testCase) => only.includes(testCase.id)) : cases;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, suite, json } = parseArgs(rest);
  if (command === 'build') {
    const file = await readJson<BehaviorCasesFile>(positional[0] ?? DEFAULT_CASES);
    file.cases = selectedCases(file, suite);
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
    const responses = await readJson<BehaviorResponses>(responsesArg);
    const results = scoreAll(selectedCases(file, suite), responses);
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
  if (command === 'compare') {
    const [beforeFile, afterFile] = positional;
    if (!beforeFile || !afterFile) throw new Error('Usage : compare avant.json apres.json');
    const [before, after] = await Promise.all([
      readJson<RunFile>(beforeFile),
      readJson<RunFile>(afterFile),
    ]);
    process.stdout.write(`${compareRuns(before, after)}\n`);
    return;
  }
  throw new Error(
    'Usage : build [--suite …] [cas.json] | score [--suite …] [--json] [cas.json] responses.json | compare avant.json apres.json',
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
