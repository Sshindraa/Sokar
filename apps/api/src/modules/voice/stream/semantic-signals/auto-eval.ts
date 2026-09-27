import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../../../env';
import { db } from '../../../../shared/db/client';
import { dispatchAlert } from '../../../../shared/observability/alert-dispatcher';
import {
  voiceSemanticEvalExamples,
  voiceSemanticEvalJudgeStatusTotal,
  voiceSemanticEvalLastRunTimestampSeconds,
  voiceSemanticEvalPrecision,
  voiceSemanticEvalRecall,
} from '../../../../shared/observability/metrics';
import { logger } from '../../../../shared/logger/pino';
import { buildAnnotationItems } from './annotation';
import { BEHAVIORS } from './behaviors';
import { buildEvalDecisionRequest, type EvalExample } from './eval-request';
import { judgeAnnotation, type JudgeLabel, type JudgeResult } from './judge';
import { scoreDecisions } from './openrouter-client';
import type { SemanticScoreResult } from './types';

export const EVAL_THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95] as const;
export const MIN_EVAL_TURNS = 20;
const MAX_CONCURRENCY = 4;
const HISTORY_TURNS = 6;
const JEV_TIMEOUT_MS = 15_000;
const DEFAULT_JEV_MODEL = 'typesafe/jev-1.13-20260917';
const SENSITIVE_BEHAVIOR_ORDER = [
  'explicitly_confirms_proposal',
  'rejects_proposal',
  'explicitly_requests_transfer',
  'explicitly_requests_message',
  'explicitly_requests_cancellation',
  'explicitly_requests_gift_card_purchase',
] as const;

export interface LabeledEvalExample extends EvalExample {
  labels: Record<string, JudgeLabel>;
}

export interface EvalMetricRow {
  behavior: (typeof BEHAVIORS)[number]['id'];
  threshold: (typeof EVAL_THRESHOLDS)[number];
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number | null;
  recall: number | null;
  examples: number;
  judgeNotObservable: number;
}

export interface EvalReport {
  rows: EvalMetricRow[];
  bestThresholds: Record<string, number | null>;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator ? numerator / denominator : null;

/** Shared by the online weekly run and the offline, human-annotated eval script. */
export function computeEvalReport(
  examples: readonly LabeledEvalExample[],
  scores: readonly (SemanticScoreResult | undefined)[],
): EvalReport {
  const rows: EvalMetricRow[] = BEHAVIORS.flatMap(({ id }) =>
    EVAL_THRESHOLDS.map((threshold) => {
      let tp = 0;
      let fp = 0;
      let tn = 0;
      let fn = 0;
      let judgeNotObservable = 0;

      examples.forEach((example, index) => {
        const label = example.labels[id];
        if (label === 'not_observable') {
          judgeNotObservable++;
          return;
        }
        if (typeof label !== 'boolean') return;

        const score = scores[index];
        if (score?.status !== 'ok') return;
        const probability = score.signals[id];
        if (!probability) return;

        const predicted = probability.present >= threshold;
        if (predicted && label) tp++;
        else if (predicted) fp++;
        else if (label) fn++;
        else tn++;
      });

      return {
        behavior: id,
        threshold,
        tp,
        fp,
        tn,
        fn,
        precision: ratio(tp, tp + fp),
        recall: ratio(tp, tp + fn),
        examples: tp + fp + tn + fn,
        judgeNotObservable,
      };
    }),
  );

  const bestThresholds: Record<string, number | null> = {};
  for (const { id } of BEHAVIORS) {
    bestThresholds[id] =
      rows.find((row) => row.behavior === id && (row.precision ?? 0) >= 0.95)?.threshold ?? null;
  }
  return { rows, bestThresholds };
}

export interface VoiceDebugTurn {
  callId: string;
  turnId: string;
  sequence: number;
  callerText: string | null;
  agentText: string | null;
}

export interface SemanticAutoEvalReport extends EvalReport {
  generatedAt: string;
  turns: number;
  judgeStatuses: { ok: number; error: number };
  jevStatuses: Record<string, number>;
  model: string;
}

export interface SemanticAutoEvalDependencies {
  enabled?: boolean;
  apiKey?: string;
  baseUrl?: string;
  judgeModel?: string;
  jevModel?: string;
  maxTurns?: number;
  now?: () => Date;
  loadTurns?: (since: Date, limit: number) => Promise<VoiceDebugTurn[]>;
  judge?: typeof judgeAnnotation;
  score?: (
    example: EvalExample,
    apiKey: string,
    baseUrl: string,
    model: string,
  ) => Promise<SemanticScoreResult>;
  dispatch?: typeof dispatchAlert;
  writeReport?: (report: SemanticAutoEvalReport, generatedAt: Date) => Promise<void>;
  warn?: (message: string) => void;
}

export type SemanticAutoEvalRunResult =
  | { status: 'disabled' | 'missing_key' | 'not_enough_data'; turns: number }
  | { status: 'completed'; turns: number; report: SemanticAutoEvalReport };

async function loadRecentTurns(since: Date, limit: number): Promise<VoiceDebugTurn[]> {
  return db.voiceDebugTurn.findMany({
    where: { createdAt: { gte: since } },
    select: { callId: true, turnId: true, sequence: true, callerText: true, agentText: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

async function persistReport(report: SemanticAutoEvalReport, generatedAt: Date): Promise<void> {
  const directory = path.resolve(__dirname, '../../../../../scratch/semantic-auto-eval');
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, `report-${generatedAt.toISOString().slice(0, 10)}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function formatRatio(value: number | null): string {
  return value === null ? 'n/d' : `${(value * 100).toFixed(1)} %`;
}

export function buildSemanticAutoEvalAlert(report: SemanticAutoEvalReport): {
  summary: string;
  detail: string;
} {
  const orderedIds = [
    ...SENSITIVE_BEHAVIOR_ORDER,
    ...BEHAVIORS.map(({ id }) => id).filter(
      (id) => !SENSITIVE_BEHAVIOR_ORDER.includes(id as (typeof SENSITIVE_BEHAVIOR_ORDER)[number]),
    ),
  ];
  const lines = orderedIds.map((behavior) => {
    const row = report.rows.find((item) => item.behavior === behavior && item.threshold === 0.8);
    const best = report.bestThresholds[behavior];
    return `${behavior}: précision/rappel à 0,8 ${formatRatio(row?.precision ?? null)} / ${formatRatio(row?.recall ?? null)}; meilleur seuil ${best === null ? 'aucun' : best}; exemples ${row?.examples ?? 0}`;
  });
  return {
    summary: `Évaluation automatique Jev : ${report.turns} tours de test`,
    detail: [
      `Tours évalués : ${report.turns}`,
      `Juge : ${report.judgeStatuses.ok} réponses valides, ${report.judgeStatuses.error} erreurs`,
      ...lines,
    ].join('\n'),
  };
}

function publishMetrics(report: SemanticAutoEvalReport, generatedAt: Date): void {
  voiceSemanticEvalPrecision.reset();
  voiceSemanticEvalRecall.reset();
  voiceSemanticEvalExamples.reset();

  for (const row of report.rows) {
    const labels = { behavior: row.behavior, threshold: String(row.threshold) };
    if (row.precision !== null) voiceSemanticEvalPrecision.set(labels, row.precision);
    if (row.recall !== null) voiceSemanticEvalRecall.set(labels, row.recall);
  }
  for (const { id } of BEHAVIORS) {
    const row = report.rows.find((item) => item.behavior === id && item.threshold === 0.8);
    voiceSemanticEvalExamples.set({ behavior: id }, row?.examples ?? 0);
  }
  voiceSemanticEvalLastRunTimestampSeconds.set(generatedAt.getTime() / 1_000);
  voiceSemanticEvalJudgeStatusTotal.inc({ status: 'ok' }, report.judgeStatuses.ok);
  voiceSemanticEvalJudgeStatusTotal.inc({ status: 'error' }, report.judgeStatuses.error);
}

export async function runSemanticAutoEval(
  dependencies: SemanticAutoEvalDependencies = {},
): Promise<SemanticAutoEvalRunResult> {
  const enabled = dependencies.enabled ?? env.VOICE_SEMANTIC_AUTO_EVAL_ENABLED === 'true';
  if (!enabled) return { status: 'disabled', turns: 0 };

  const apiKey = (dependencies.apiKey ?? env.OPENROUTER_API_KEY ?? '').trim();
  if (!apiKey) {
    (dependencies.warn ?? ((message) => logger.warn(message)))(
      '[voice-semantic-auto-eval] OPENROUTER_API_KEY absent; exécution ignorée',
    );
    return { status: 'missing_key', turns: 0 };
  }

  const now = dependencies.now ?? (() => new Date());
  const generatedAt = now();
  const maxTurns = dependencies.maxTurns ?? env.VOICE_SEMANTIC_AUTO_EVAL_MAX_TURNS;
  const turns = await (dependencies.loadTurns ?? loadRecentTurns)(
    new Date(generatedAt.getTime() - 7 * 24 * 60 * 60 * 1_000),
    maxTurns,
  );
  const examples = buildAnnotationItems(turns, HISTORY_TURNS);
  if (examples.length < MIN_EVAL_TURNS) {
    voiceSemanticEvalLastRunTimestampSeconds.set(generatedAt.getTime() / 1_000);
    await (dependencies.dispatch ?? dispatchAlert)({
      kind: 'voice_semantic_auto_eval',
      severity: 'info',
      summary: `Pas assez d'appels de test (${examples.length} tours)`,
      detail: `Il faut au moins ${MIN_EVAL_TURNS} tours annotables ; ${examples.length} trouvé(s) sur les 7 derniers jours.`,
      sms: false,
    });
    return { status: 'not_enough_data', turns: examples.length };
  }

  const judgeModel = dependencies.judgeModel ?? env.VOICE_SEMANTIC_JUDGE_MODEL;
  const jevModel = dependencies.jevModel ?? env.VOICE_SEMANTIC_SIGNALS_MODEL ?? DEFAULT_JEV_MODEL;
  const baseUrl = dependencies.baseUrl ?? env.OPENROUTER_BASE_URL;
  const judge = dependencies.judge ?? judgeAnnotation;
  const score =
    dependencies.score ??
    ((example, key, url, model) =>
      scoreDecisions(buildEvalDecisionRequest(example, model), {
        apiKey: key,
        baseUrl: url,
        signal: AbortSignal.timeout(JEV_TIMEOUT_MS),
      }));
  const paired: Array<{ jev: SemanticScoreResult; judge: JudgeResult } | undefined> = new Array(
    examples.length,
  );
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENCY, examples.length) }, async () => {
      while (cursor < examples.length) {
        const index = cursor++;
        const example = examples[index];
        const [jev, judged] = await Promise.all([
          score(example, apiKey, baseUrl, jevModel),
          judge(example, { apiKey, baseUrl, model: judgeModel }),
        ]);
        paired[index] = { jev, judge: judged };
      }
    }),
  );

  const judgeStatuses = { ok: 0, error: 0 };
  const jevStatuses: Record<string, number> = {};
  const labeledExamples: LabeledEvalExample[] = examples.map((example, index) => {
    const pair = paired[index];
    const judged = pair?.judge;
    const jevStatus = pair?.jev.status ?? 'missing';
    jevStatuses[jevStatus] = (jevStatuses[jevStatus] ?? 0) + 1;
    if (judged?.status === 'ok') judgeStatuses.ok++;
    else judgeStatuses.error++;
    return {
      ...example,
      labels: judged?.status === 'ok' ? judged.output.labels : {},
    };
  });
  const scores = paired.map((pair) => pair?.jev);
  const computed = computeEvalReport(labeledExamples, scores);
  const report: SemanticAutoEvalReport = {
    ...computed,
    generatedAt: generatedAt.toISOString(),
    turns: examples.length,
    judgeStatuses,
    jevStatuses,
    model: jevModel,
  };

  publishMetrics(report, generatedAt);
  await (dependencies.writeReport ?? persistReport)(report, generatedAt);
  const alert = buildSemanticAutoEvalAlert(report);
  await (dependencies.dispatch ?? dispatchAlert)({
    kind: 'voice_semantic_auto_eval',
    severity: 'info',
    ...alert,
    sms: false,
  });
  logger.info(
    {
      turns: report.turns,
      judgeStatuses: report.judgeStatuses,
      jevStatuses: report.jevStatuses,
    },
    '[voice-semantic-auto-eval] Évaluation hebdomadaire terminée',
  );
  return { status: 'completed', turns: report.turns, report };
}
