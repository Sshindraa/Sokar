/**
 * Jeu de test de comportements du tour structuré (voir src/modules/voice/behavior-eval).
 *
 *   tsx scripts/voice-behavior-eval.ts build [cas.json] [--only id,comportement] [--samples N]
 *                                                                    > requests.json
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

/** Plafond d'entrée d'un passage : chaque requête renvoie tout le prompt et consomme le quota des appels réels. */
const DEFAULT_MAX_INPUT_TOKENS = 500_000;

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'build') {
    const file = await readJson<BehaviorCasesFile>(
      rest[0] && !rest[0].startsWith('--') ? rest[0] : DEFAULT_CASES,
    );
    const only = option(rest, '--only')
      ?.split(',')
      .map((item) => item.trim());
    const samples = Number(option(rest, '--samples')) || undefined;
    file.cases = file.cases
      .filter((testCase) => !only || only.includes(testCase.id) || only.includes(testCase.behavior))
      .map((testCase) => (samples ? { ...testCase, samples } : testCase));
    if (!file.cases.length) throw new Error('Aucun cas ne correspond à --only');
    const requests = buildRequests(file);
    // Estimation avant envoi (≈ 3,5 caractères par token) : ce passage consomme le quota du fournisseur.
    const estimated = requests.reduce(
      (sum, request) =>
        sum + request.samples * Math.round(JSON.stringify(request.messages).length / 3.5),
      0,
    );
    const count = requests.reduce((sum, request) => sum + request.samples, 0);
    const cap = Number(process.env.VBE_MAX_INPUT_TOKENS) || DEFAULT_MAX_INPUT_TOKENS;
    if (estimated > cap) {
      throw new Error(
        `≈ ${(estimated / 1e6).toFixed(2)} M tokens estimés, au-delà du plafond de ${(cap / 1e6).toFixed(2)} M : ` +
          'cibler avec --only, réduire avec --samples, ou relever VBE_MAX_INPUT_TOKENS en connaissance de cause.',
      );
    }
    process.stderr.write(
      `≈ ${count} requêtes, ≈ ${(estimated / 1e6).toFixed(2)} M tokens en entrée\n`,
    );
    process.stdout.write(JSON.stringify({ requests }));
    return;
  }
  if (command === 'score') {
    const [casesArg, responsesArg] = rest.length > 1 ? rest : [DEFAULT_CASES, rest[0]];
    // Un passage ciblé ne note que les cas qu'il a rejoués.
    if (!responsesArg) throw new Error('Usage : score [cas.json] responses.json');
    const file = await readJson<BehaviorCasesFile>(casesArg);
    const responses = await readJson<BehaviorResponses>(responsesArg);
    const results = scoreAll(
      file.cases.filter((testCase) => testCase.id in responses.responses),
      responses,
    );
    const used = responses.usage;
    const usage = used
      ? `Tokens facturés : ${used.promptTokens + used.completionTokens} (${used.requests} requêtes)\n`
      : '';
    process.stdout.write(`Modèle : ${responses.model}\n${usage}\n${formatReport(results)}\n`);
    if (results.some((result) => !result.passed)) process.exitCode = 1;
    return;
  }
  throw new Error('Usage : build [cas.json] | score [cas.json] responses.json');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
