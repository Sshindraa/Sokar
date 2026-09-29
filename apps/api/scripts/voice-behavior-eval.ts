/**
 * Jeu de test de comportements du tour structuré (voir src/modules/voice/behavior-eval).
 *
 *   tsx scripts/voice-behavior-eval.ts build [cas.json]              > requests.json
 *   tsx scripts/voice-behavior-eval.ts score [cas.json] responses.json
 *
 * `build` compose les vraies requêtes du prompt courant ; le rejeu contre le modèle
 * est fait par voice-behavior-replay.mjs (sur le serveur, où sont les clés) ; `score`
 * compare aux seuils et sort en erreur si un comportement n'est plus tenu.
 * Enchaînement complet : scripts/ops/voice-behavior-eval.sh.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRequests } from '../src/modules/voice/behavior-eval/build';
import { formatReport, scoreAll } from '../src/modules/voice/behavior-eval/score';
import type {
  BehaviorCasesFile,
  BehaviorResponses,
} from '../src/modules/voice/behavior-eval/types';

const DEFAULT_CASES = path.join(__dirname, 'fixtures/voice-behavior/cases.json');

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'build') {
    const file = await readJson<BehaviorCasesFile>(rest[0] ?? DEFAULT_CASES);
    process.stdout.write(JSON.stringify({ requests: buildRequests(file) }));
    return;
  }
  if (command === 'score') {
    const [casesArg, responsesArg] = rest.length > 1 ? rest : [DEFAULT_CASES, rest[0]];
    if (!responsesArg) throw new Error('Usage : score [cas.json] responses.json');
    const file = await readJson<BehaviorCasesFile>(casesArg);
    const responses = await readJson<BehaviorResponses>(responsesArg);
    const results = scoreAll(file.cases, responses);
    process.stdout.write(`Modèle : ${responses.model}\n\n${formatReport(results)}\n`);
    if (results.some((result) => !result.passed)) process.exitCode = 1;
    return;
  }
  throw new Error('Usage : build [cas.json] | score [cas.json] responses.json');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
