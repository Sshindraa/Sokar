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

/**
 * Consigne candidate (non expédiée tant qu'elle n'est pas mesurée) : un principe, sans exemple. C'est la FIN de ce
 * que dit l'appelant qui compte ; une demande ou une question complète à la fin rend le tour complet, même si un
 * début de phrase a été abandonné ou repris (appel 03b19223 : « inachevé » sur une question complète précédée d'un
 * début abandonné, 2,98 s de silence).
 */
export const JUDGE_INSTRUCTIONS_CANDIDATE =
  JUDGE_INSTRUCTIONS +
  " C'est la fin de ce que dit l'appelant qui compte : une demande ou une question complète à la fin rend le tour complet, même si un début de phrase a été abandonné ou repris.";

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

/** Le contrôle attend `complete=true` : un témoin du juge, quelle que soit l'origine du cas. */
export function expectsComplete(testCase: BehaviorCase): boolean {
  return testCase.checks.some(
    (check) => check.kind === 'field' && check.path === 'turnComplete' && check.equals === true,
  );
}

export function buildJudgeRequest(
  testCase: BehaviorCase,
  file: BehaviorCasesFile,
  samples?: number,
  instructions?: string,
): BehaviorRequest {
  const lastQuestion = historyOf(testCase, file)
    .filter((message) => message.role === 'assistant')
    .at(-1)?.content;
  return {
    id: testCase.id,
    // Le plan chiffré fixe les tirages (pas ceux du fichier, écrits pour le tour complet).
    samples: samples ?? judgeSamples(testCase),
    messages: buildTurnEndJudgeMessages(lastQuestion, testCase.transcript, instructions) as never,
    format: TURN_END_JUDGE_FORMAT,
  };
}

export function buildJudgeRequests(
  file: BehaviorCasesFile,
  samples?: number,
  instructions?: string,
): BehaviorRequest[] {
  return file.cases
    .filter(isJudgeCase)
    .map((testCase) => buildJudgeRequest(testCase, file, samples, instructions));
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
  return testCase.origin === 'control' || expectsComplete(testCase)
    ? JUDGE_DRAWS.control
    : JUDGE_DRAWS.defect;
}

/** Les sorties sont celles du juge (`{ complete }`), pas du tour complet. */
export function isJudgeOutput(responses: BehaviorResponses): boolean {
  return Object.values(responses.responses)
    .flat()
    .some((sample) => sample !== null && typeof sample.complete === 'boolean');
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

/** Plancher du témoin, et baisse tolérée (points) sur la lignée b686b241 entre deux consignes du juge. */
export const JUDGE_LINEAGE_TOLERANCE = 0.05;
/** La lignée « je voudrais bien venir » (appel b686b241) : le juge ne doit pas la lâcher. */
export const JUDGE_PROTECTED_LINEAGE = 'attend-annonce-intention';

/**
 * Règles d'acceptation d'une nouvelle consigne du juge, comparée à l'ancienne (deux bras du juge, même session) :
 * chaque cas qui attend « complet » reste à 95 % ou plus dans le bras candidat, et la lignée b686b241 ne baisse pas
 * (écart de plus de 5 points = baisse). Le gain sur le cas réel du faux « inachevé » est rapporté.
 */
export function judgeInstructionsVerdict(
  report: AbReport,
  witnessIds: ReadonlySet<string>,
  realCaseId: string,
): string {
  const lines = ["Règles d'acceptation de la consigne candidate du juge :"];
  for (const entry of report.cases.filter((c) => witnessIds.has(c.id))) {
    const rate = entry.candidate.draws ? entry.candidate.successes / entry.candidate.draws : 0;
    lines.push(
      `  ${rate >= JUDGE_CONTROL_FLOOR ? '✓' : '✗'} ${entry.id} ≥ 95 % : ${(rate * 100).toFixed(0)} % (${entry.candidate.successes}/${entry.candidate.draws}, consigne actuelle ${entry.reference.successes}/${entry.reference.draws})`,
    );
  }
  const protectedLineage = report.lineages.find((l) => l.root === JUDGE_PROTECTED_LINEAGE);
  if (protectedLineage) {
    lines.push(
      `  ${protectedLineage.delta >= -JUDGE_LINEAGE_TOLERANCE ? '✓' : '✗'} lignée b686b241 (${JUDGE_PROTECTED_LINEAGE}) ne baisse pas : ${(protectedLineage.referenceRate * 100).toFixed(0)} % → ${(protectedLineage.candidateRate * 100).toFixed(0)} % (${protectedLineage.delta >= 0 ? '+' : '−'}${Math.abs(protectedLineage.delta * 100).toFixed(0)} points, tolérance ${JUDGE_LINEAGE_TOLERANCE * 100} ; intervalle à 90 % [${(protectedLineage.low * 100).toFixed(0)} ; ${(protectedLineage.high * 100).toFixed(0)}])`,
    );
  }
  const real = report.cases.find((c) => c.id === realCaseId);
  if (real) {
    lines.push(
      `  Cas réel 03b19223 (${realCaseId}) : ${real.reference.successes}/${real.reference.draws} → ${real.candidate.successes}/${real.candidate.draws}`,
    );
  }
  for (const lineage of report.lineages.filter((l) => l.root !== JUDGE_PROTECTED_LINEAGE)) {
    lines.push(
      `  (informatif) lignée ${lineage.root} : ${(lineage.referenceRate * 100).toFixed(0)} % → ${(lineage.candidateRate * 100).toFixed(0)} %`,
    );
  }
  return lines.join('\n');
}
