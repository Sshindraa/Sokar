import type {
  BehaviorAbResponses,
  BehaviorCase,
  BehaviorCasesFile,
  BehaviorMessage,
  BehaviorResponses,
} from './types';
import type { BehaviorRequest } from './build';
import {
  buildTurnEndJudgeMessages,
  TURN_END_JUDGE_FORMAT,
  TURN_END_JUDGE_INSTRUCTIONS,
} from '../stream/structured-turn/turn-end-judge';
import type { AbReport } from './paired';

/**
 * Prototype de banc : le jugement de fin de tour séparé du modèle de dialogue (aucun usage en production).
 *
 * Aujourd'hui `turnComplete` est le premier champ de la grosse requête du tour (règles de réservation, état
 * vérifié, calendrier, plus de trois mille tokens). Ici : une requête minimale, qui ne voit que la dernière
 * question de l'agent et ce que l'appelant a dit, et qui ne rend que `{ complete }`. Aucune règle de
 * réservation, aucun exemple, aucun mot-clé, et pas même les principes du prompt actuel (phrase qui annonce,
 * phrase qui nie sa valeur) : on mesure si la séparation seule suffit.
 */
/** La consigne de production : le banc mesure exactement ce qui part en appel. */
export const JUDGE_INSTRUCTIONS = TURN_END_JUDGE_INSTRUCTIONS;

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
    messages: buildTurnEndJudgeMessages(lastQuestion, testCase.transcript) as never,
    format: TURN_END_JUDGE_FORMAT,
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

/** Tirages d'un cas du plan chiffré (mêmes pour les deux bras de l'A/B). */
export function judgeSamples(testCase: BehaviorCase): number {
  return testCase.origin === 'control' ? JUDGE_DRAWS.control : JUDGE_DRAWS.defect;
}

/** Gain exigé sur les défauts (points) et plancher de chaque témoin dans le bras candidat. */
export const JUDGE_MIN_GAIN = 0.15;
export const JUDGE_CONTROL_FLOOR = 0.95;

const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)];
};

/**
 * Règles d'acceptation du juge (fixées avant le rejeu) : borne basse de l'intervalle à 90 % du gain sur les défauts
 * au-dessus de zéro, gain d'au moins 15 points, chaque témoin à 95 % ou plus. Durées mesurées par le rejeu en plus.
 */
export function judgeVerdict(report: AbReport, ab: BehaviorAbResponses): string {
  const defects = report.families.find((family) => family.group === 'defauts');
  const controls = report.cases.filter((entry) => entry.origin === 'control');
  const lines = ["Règles d'acceptation du juge :"];
  if (defects) {
    const gain = defects.delta;
    lines.push(
      `  ${defects.low > 0 ? '✓' : '✗'} borne basse du gain sur les défauts > 0 : ${(defects.low * 100).toFixed(1)} points`,
      `  ${gain >= JUDGE_MIN_GAIN ? '✓' : '✗'} gain ≥ 15 points : ${(gain * 100).toFixed(1)} points (${(defects.referenceRate * 100).toFixed(0)} % → ${(defects.candidateRate * 100).toFixed(0)} %)`,
    );
  }
  for (const entry of controls) {
    const rate = entry.candidate.draws ? entry.candidate.successes / entry.candidate.draws : 0;
    lines.push(
      `  ${rate >= JUDGE_CONTROL_FLOOR ? '✓' : '✗'} témoin ${entry.id} ≥ 95 % : ${(rate * 100).toFixed(0)} % (${entry.candidate.successes}/${entry.candidate.draws}, référence ${entry.reference.successes}/${entry.reference.draws})`,
    );
  }
  const flat = (arm: 'reference' | 'candidate') =>
    Object.values(ab.arms[arm].latencyMs ?? {}).flat();
  lines.push(
    `  Durée par requête sur ${ab.provider} (informatif, pas celle de la production) : tour complet médiane ${median(flat('reference')) ?? '?'} ms, juge médiane ${median(flat('candidate')) ?? '?'} ms`,
  );
  return lines.join('\n');
}
