/** Offline evaluation of already anonymized JSONL. Reports contain aggregate values only. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RESPAN_BASE_URL } from '@sokar/config';
import {
  BEHAVIORS,
  BEHAVIOR_SET_VERSION,
} from '../src/modules/voice/stream/semantic-signals/behaviors';
import { scoreSpan } from '../src/modules/voice/stream/semantic-signals/client';
import type { BehaviorId } from '../src/modules/voice/stream/semantic-signals/behaviors';
import type {
  SemanticScoreResult,
  SpanRequest,
} from '../src/modules/voice/stream/semantic-signals/types';

const message = z.object({ role: z.enum(['user', 'assistant']), content: z.string() });
const exampleSchema = z.object({
  id: z.string(),
  input: z.array(message),
  output: message,
  labels: z.record(z.union([z.boolean(), z.literal('not_observable')])),
});
const thresholds = [0.5, 0.7, 0.8, 0.9, 0.95];
const ratio = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null;
const percentile = (values: number[], quantile: number) =>
  values.length
    ? values[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)]
    : null;

async function main(): Promise<void> {
  const file = process.argv[2] ?? 'scripts/fixtures/semantic-eval.example.jsonl';
  const concurrency = Number(process.env.VOICE_SEMANTIC_EVAL_CONCURRENCY ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20)
    throw new Error('Invalid concurrency');
  const key = process.env.RESPAN_API_KEY?.trim();
  if (!key) throw new Error('RESPAN_API_KEY is required');
  const examples = (await readFile(file, 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => exampleSchema.parse(JSON.parse(line)));
  const results: Array<SemanticScoreResult | undefined> = new Array(examples.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, examples.length) }, async () => {
      while (cursor < examples.length) {
        const index = cursor++;
        const example = examples[index];
        const request: SpanRequest = {
          model: process.env.VOICE_SEMANTIC_SIGNALS_MODEL ?? 'span-01-pro',
          span: { input: example.input, output: example.output },
          behaviors: BEHAVIORS.map(({ id, definition }) => ({ id, definition })),
        };
        results[index] = await scoreSpan(request, {
          apiKey: key,
          baseUrl: process.env.RESPAN_BASE_URL ?? RESPAN_BASE_URL,
          signal: AbortSignal.timeout(10_000),
        });
      }
    }),
  );
  const successful = results.filter(
    (result): result is Extract<SemanticScoreResult, { status: 'ok' }> => result?.status === 'ok',
  );
  const latencies = successful.map((result) => result.durationMs).sort((a, b) => a - b);
  const rows = BEHAVIORS.flatMap(({ id }) =>
    thresholds.map((threshold) => {
      let tp = 0,
        fp = 0,
        tn = 0,
        fn = 0,
        notObservable = 0,
        labeled = 0;
      results.forEach((result, index) => {
        if (result?.status !== 'ok') return;
        const label = examples[index].labels[id];
        const probability = result.signals[id];
        if (label === undefined || !probability) return;
        labeled++;
        if (probability.notObservable >= 0.5 || label === 'not_observable') {
          notObservable++;
          return;
        }
        const predicted = probability.present >= threshold;
        if (predicted && label) tp++;
        else if (predicted) fp++;
        else if (label) fn++;
        else tn++;
      });
      return {
        behavior: id as BehaviorId,
        threshold,
        precision: ratio(tp, tp + fp),
        recall: ratio(tp, tp + fn),
        falsePositiveRate: ratio(fp, fp + tn),
        falseNegativeRate: ratio(fn, fn + tp),
        notObservableRate: ratio(notObservable, labeled),
        counts: { tp, fp, tn, fn, notObservable, labeled },
      };
    }),
  );
  const report = {
    behaviorSetVersion: BEHAVIOR_SET_VERSION,
    examples: examples.length,
    statuses: results.reduce<Record<string, number>>((totals, result) => {
      const status = result?.status ?? 'missing';
      totals[status] = (totals[status] ?? 0) + 1;
      return totals;
    }, {}),
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    rows,
  };
  for (const row of rows) process.stdout.write(`${JSON.stringify(row)}\n`);
  process.stdout.write(`latencyMs ${JSON.stringify(report.latencyMs)}\n`);
  const outputDir = path.resolve('scratch/semantic-signals-eval');
  await mkdir(outputDir, { recursive: true });
  const output = path.join(outputDir, `report-${Date.now()}.json`);
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${output}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Evaluation failed');
  process.exitCode = 1;
});
