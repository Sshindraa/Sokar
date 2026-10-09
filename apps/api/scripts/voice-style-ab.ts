/**
 * Mesure avant / après du registre de la maison (réglages « Style » et « Ton de voix » de l'onboarding).
 *
 *   tsx scripts/voice-style-ab.ts build <réglage> > requests.json
 *       réglage : default (aucun réglage) | gastro-formal (gastronomique + formel)
 *   tsx scripts/voice-style-ab.ts judge-build <ref.json> <réglage> <cand.json> <réglage> > judge.json
 *   tsx scripts/voice-style-ab.ts report <réglage> <responses.json>   (contrôles du cas, par bras)
 *   tsx scripts/voice-style-ab.ts pairs <judge-responses.json>        (verdicts du juge)
 *
 * Rejeu : scripts/voice-behavior-replay.mjs, avec VBE_ARM_B pour le bras candidat (même session, requêtes
 * alternées). Le juge est le modèle de production : un ordre de grandeur, pas une mesure absolue.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildRequest, type BehaviorPersona } from '../src/modules/voice/behavior-eval/build';
import { scoreAll } from '../src/modules/voice/behavior-eval/score';
import { personalityStyleLines } from '../src/modules/voice/prompts';
import type {
  BehaviorCasesFile,
  BehaviorResponses,
} from '../src/modules/voice/behavior-eval/types';

const CASES = 'scripts/fixtures/voice-behavior/cases.json';
/** Essais par cas : 3 par défaut, STYLE_DRAWS=2 pour un rejeu réduit. */
const DRAWS = Number(process.env.STYLE_DRAWS) || 3;
/** Cas à réponse libre : c'est là que le registre se voit. */
const CASE_IDS = process.env.STYLE_CASES
  ? process.env.STYLE_CASES.split(',')
  : ['conge-merci', 'date-dans-question', 'repond-reponse-complete'];

const PERSONAS: Record<string, BehaviorPersona | undefined> = {
  default: undefined,
  'gastro-formal': { profileType: 'GASTRONOMIQUE', fillerStyle: 'FORMAL' },
};

const JUDGE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'house_register_pair',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        house: { type: 'string', enum: ['A', 'B', 'same'] },
        natural: { type: 'string', enum: ['A', 'B', 'same'] },
      },
      required: ['house', 'natural'],
      additionalProperties: false,
    },
  },
} as const;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

function sayOf(response: Record<string, unknown> | null | undefined): string {
  const say = response?.say;
  return typeof say === 'string' ? say.trim() : '';
}

/** Ordre A/B tiré de l'identifiant : reproductible, sans biais de position systématique. */
function candidateIsFirst(key: string): boolean {
  return createHash('sha256').update(key).digest()[0] % 2 === 0;
}

function judgeInstructions(): string {
  const target = personalityStyleLines({ profileType: 'GASTRONOMIQUE', fillerStyle: 'FORMAL' });
  return [
    "Tu compares deux répliques A et B d'un assistant de restaurant au téléphone, pour la même situation. Tu ne juges ni l'exactitude ni l'utilité de ce qui est dit.",
    'La maison doit parler ainsi :',
    ...target.map((line) => `- ${line}`),
    'house : laquelle des deux se rapproche le plus de cette manière de parler (A, B, ou same si aucune différence nette).',
    'natural : laquelle sonnerait le mieux au téléphone, naturelle et fluide (A, B, ou same si aucune différence nette).',
    "Réponds uniquement par l'objet demandé.",
  ].join('\n');
}

async function build(personaId: string) {
  if (!(personaId in PERSONAS)) throw new Error(`Réglage inconnu : ${personaId}`);
  const file = await readJson<BehaviorCasesFile>(CASES);
  const requests = CASE_IDS.map((caseId) => {
    const testCase = file.cases.find((candidate) => candidate.id === caseId);
    if (!testCase) throw new Error(`Cas introuvable : ${caseId}`);
    return {
      ...buildRequest({ ...testCase, samples: DRAWS }, file, { persona: PERSONAS[personaId] }),
      id: `${caseId}@${personaId}`,
      samples: DRAWS,
    };
  });
  process.stderr.write(`${requests.length} requêtes × ${DRAWS} tirages.\n`);
  process.stdout.write(JSON.stringify({ requests }));
}

async function judgeBuild(
  refPath: string,
  refPersona: string,
  candPath: string,
  candPersona: string,
) {
  const ref = await readJson<BehaviorResponses>(refPath);
  const cand = await readJson<BehaviorResponses>(candPath);
  const instructions = judgeInstructions();
  const requests = CASE_IDS.flatMap((caseId) =>
    Array.from({ length: DRAWS }, (_, index) => {
      const a = sayOf(ref.responses[`${caseId}@${refPersona}`]?.[index]);
      const b = sayOf(cand.responses[`${caseId}@${candPersona}`]?.[index]);
      if (!a || !b) return [];
      const key = `${caseId}#${index}`;
      const first = candidateIsFirst(key);
      const [left, right] = first ? [b, a] : [a, b];
      return [
        {
          id: `${key}|cand=${first ? 'A' : 'B'}`,
          samples: 1,
          maxTokens: 60,
          messages: [
            { role: 'system', content: instructions },
            { role: 'user', content: `Réplique A :\n${left}\n\nRéplique B :\n${right}` },
          ],
          format: JUDGE_FORMAT,
        },
      ];
    }).flat(),
  );
  process.stderr.write(`${requests.length} paires.\n`);
  process.stdout.write(JSON.stringify({ requests }));
}

async function report(persona: string, responsesPath: string) {
  const file = await readJson<BehaviorCasesFile>(CASES);
  const raw = await readJson<BehaviorResponses>(responsesPath);
  process.stdout.write(`Contrôles du cas, réglage ${persona} :\n`);
  for (const caseId of CASE_IDS) {
    const testCase = file.cases.find((candidate) => candidate.id === caseId);
    if (!testCase) throw new Error(`Cas introuvable : ${caseId}`);
    const [result] = scoreAll([testCase], {
      ...raw,
      responses: { [caseId]: raw.responses[`${caseId}@${persona}`] ?? [] },
    });
    const rates = result.checks.map((check) => `${Math.round(check.rate * 100)} %`);
    process.stdout.write(
      `  ${caseId.padEnd(26)} ${result.passed ? 'tenu  ' : 'ÉCHEC '} ${result.valid}/${result.samples} valides  contrôles ${rates.join(' / ') || '-'}\n`,
    );
  }
}

async function pairs(judgePath: string) {
  const judged = await readJson<BehaviorResponses>(judgePath);
  const tally = {
    house: { cand: 0, ref: 0, same: 0 },
    natural: { cand: 0, ref: 0, same: 0 },
  };
  for (const [id, draws] of Object.entries(judged.responses)) {
    const side = id.split('|')[1] === 'cand=A' ? 'A' : 'B';
    const draw = draws[0];
    if (!draw) continue;
    for (const axis of ['house', 'natural'] as const) {
      const verdict = String(draw[axis]);
      if (verdict === 'same') tally[axis].same += 1;
      else if (verdict === side) tally[axis].cand += 1;
      else tally[axis].ref += 1;
    }
  }
  process.stdout.write(
    `registre de la maison : candidat ${tally.house.cand}, référence ${tally.house.ref}, égal ${tally.house.same}\n` +
      `naturel au téléphone  : candidat ${tally.natural.cand}, référence ${tally.natural.ref}, égal ${tally.natural.same}\n`,
  );
}

const [command, ...args] = process.argv.slice(2);
const run = async (): Promise<void> => {
  if (command === 'build' && args.length === 1) return build(args[0]);
  if (command === 'judge-build' && args.length === 4) {
    return judgeBuild(args[0], args[1], args[2], args[3]);
  }
  if (command === 'report' && args.length === 2) return report(args[0], args[1]);
  if (command === 'pairs' && args.length === 1) return pairs(args[0]);
  throw new Error(
    'Usage : build <réglage> | judge-build <ref.json> <réglage> <cand.json> <réglage> | report <réglage> <responses.json> | pairs <judge.json>',
  );
};
run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
