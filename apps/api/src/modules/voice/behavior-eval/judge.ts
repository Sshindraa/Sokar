import type { BehaviorCase, BehaviorCasesFile, BehaviorMessage, BehaviorResponses } from './types';
import type { BehaviorRequest } from './build';

/**
 * Prototype de banc : le jugement de fin de tour séparé du modèle de dialogue (aucun usage en production).
 *
 * Aujourd'hui `turnComplete` est le premier champ de la grosse requête du tour (règles de réservation, état
 * vérifié, calendrier, plus de trois mille tokens). Ici : une requête minimale, qui ne voit que la dernière
 * question de l'agent et ce que l'appelant a dit, et qui ne rend que `{ complete }`. Aucune règle de
 * réservation, aucun exemple, aucun mot-clé, et pas même les principes du prompt actuel (phrase qui annonce,
 * phrase qui nie sa valeur) : on mesure si la séparation seule suffit.
 */
export const JUDGE_INSTRUCTIONS =
  "Tu juges un seul point. Un agent téléphonique vient de poser une question et l'appelant répond. " +
  "La transcription vient d'une reconnaissance vocale au téléphone : elle peut s'arrêter en plein milieu d'une phrase ou d'une pensée. " +
  "Dis si l'appelant a terminé ce qu'il avait à dire pour le moment (complete=true), ou si tu attends encore la suite (complete=false).";

export const JUDGE_SCHEMA_NAME = 'turn_end_judge';

const JUDGE_SCHEMA = {
  type: 'object',
  properties: { complete: { type: 'boolean' } },
  required: ['complete'],
  additionalProperties: false,
};

/** Tirages par cas du plan chiffré : 16 par défaut (gain de 15 points), 24 par témoin (95 % à une erreur près). */
export const JUDGE_DRAWS = { defect: 16, control: 24 };

function historyOf(testCase: BehaviorCase, file: BehaviorCasesFile): BehaviorMessage[] {
  if (typeof testCase.history !== 'string') return testCase.history;
  const named = file.histories?.[testCase.history];
  if (!named) throw new Error(`Historique inconnu « ${testCase.history} » (cas ${testCase.id})`);
  return named;
}

/** Les cas que le juge peut passer : ceux dont un contrôle porte sur `turnComplete`. */
export function isJudgeCase(testCase: BehaviorCase): boolean {
  return testCase.checks.some((check) => 'path' in check && check.path === 'turnComplete');
}

/** Le même cas, jugé sur `turnComplete` seulement (le juge ne rend ni brouillon ni phrase). */
export function turnCompleteOnly(testCase: BehaviorCase): BehaviorCase {
  return {
    ...testCase,
    checks: testCase.checks.filter((check) => 'path' in check && check.path === 'turnComplete'),
  };
}

export function buildJudgeRequest(
  testCase: BehaviorCase,
  file: BehaviorCasesFile,
  samples?: number,
): BehaviorRequest {
  const lastQuestion = historyOf(testCase, file)
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  return {
    id: testCase.id,
    // Le plan chiffré fixe les tirages (pas ceux du fichier, écrits pour le tour complet).
    samples: samples ?? (testCase.origin === 'control' ? JUDGE_DRAWS.control : JUDGE_DRAWS.defect),
    messages: [
      { role: 'system', content: JUDGE_INSTRUCTIONS },
      {
        role: 'user',
        content: `Dernière question de l'agent : ${lastQuestion ?? '(aucune)'}\nCe que l'appelant a dit : ${testCase.transcript}`,
      },
    ] as never,
    format: {
      type: 'json_schema',
      json_schema: { name: JUDGE_SCHEMA_NAME, strict: true, schema: JUDGE_SCHEMA },
    },
  };
}

export function buildJudgeRequests(file: BehaviorCasesFile, samples?: number): BehaviorRequest[] {
  return file.cases
    .filter(isJudgeCase)
    .map((testCase) => buildJudgeRequest(testCase, file, samples));
}

/** Sortie du juge sous la forme du tour structuré, pour passer les mêmes contrôles (`turnComplete`). */
export function judgeAsTurn(responses: BehaviorResponses): BehaviorResponses {
  return {
    ...responses,
    responses: Object.fromEntries(
      Object.entries(responses.responses).map(([id, samples]) => [
        id,
        samples.map((sample) =>
          sample && typeof sample.complete === 'boolean' ? { turnComplete: sample.complete } : null,
        ),
      ]),
    ),
  };
}
