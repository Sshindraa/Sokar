import { readFileSync } from 'node:fs';
import { NB_CORPUS, type CriticalCategory } from './nb-corpus';
import { digitSequence, normalizeTokens, wordErrorRate } from './nb-normalize';
import { bootstrapInterval, percentile } from './nb-flux-stats';

type Model = 'nova-3' | 'flux-general-multi';
type Variant = 'clean' | 'noisy';
type Split = 'calibration' | 'validation';

interface Result {
  clipId: string;
  model: Model;
  split: Split;
  variant: Variant;
  transcript?: string;
  error?: string | null;
  latencyMs?: number | null;
}

interface ClipScore {
  correct: number;
  total: number;
  werTotal: number;
  records: number;
  latencies: number[];
  errors: number;
}

const MODELS: Model[] = ['nova-3', 'flux-general-multi'];
const SPLITS: Split[] = ['calibration', 'validation'];
const VARIANTS: Variant[] = ['clean', 'noisy'];
const clips = new Map(NB_CORPUS.map((clip) => [clip.id, clip]));

function splitForClip(clipId: string): Split {
  const calibration = new Set([
    'c01',
    'c03',
    'c05',
    'c07',
    'c09',
    'h01',
    'h03',
    'h05',
    'h07',
    'd01',
    'd03',
    'n01',
    'n03',
    'n05',
    't01',
    't03',
  ]);
  return calibration.has(clipId) ? 'calibration' : 'validation';
}

function criticalMatches(transcript: string, category: CriticalCategory, value: string): boolean {
  if (category === 'telephone') return digitSequence(transcript).includes(value);
  return normalizeTokens(transcript).includes(value);
}

function rate(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}

function percent(value: number, interval: { lower: number; upper: number } | null): string {
  if (!interval) return `${(value * 100).toFixed(1)}%`;
  return `${(value * 100).toFixed(1)}% [${(interval.lower * 100).toFixed(1)}–${(
    interval.upper * 100
  ).toFixed(1)}]`;
}

function decimal(value: number, interval: { lower: number; upper: number } | null): string {
  if (!interval) return value.toFixed(3);
  return `${value.toFixed(3)} [${interval.lower.toFixed(3)}–${interval.upper.toFixed(3)}]`;
}

function latency(value: number, interval: { lower: number; upper: number } | null): string {
  if (!Number.isFinite(value)) return '—';
  if (!interval) return `${Math.round(value)} ms`;
  return `${Math.round(value)} ms [${Math.round(interval.lower)}–${Math.round(interval.upper)}]`;
}

function summarize(records: Result[], model: Model, split: Split, variant: Variant): string {
  const group = records.filter(
    (record) => record.model === model && record.split === split && record.variant === variant,
  );
  const scores = new Map<string, ClipScore>();
  for (const clip of NB_CORPUS.filter((item) => splitForClip(item.id) === split)) {
    scores.set(clip.id, {
      correct: 0,
      total: 0,
      werTotal: 0,
      records: 0,
      latencies: [],
      errors: 0,
    });
  }

  const received = new Map<string, Result>();
  for (const record of group) {
    if (!clips.has(record.clipId)) throw new Error(`Clip inconnu: ${record.clipId}`);
    received.set(record.clipId, record);
  }
  for (const [clipId, score] of scores) {
    const clip = clips.get(clipId)!;
    const result = received.get(clipId);
    const failed = !result || Boolean(result.error) || !result.transcript?.trim();
    const transcript = failed ? '' : result.transcript!.trim();
    score.records = 1;
    score.errors = failed ? 1 : 0;
    for (const critical of clip.critical) {
      score.total++;
      if (criticalMatches(transcript, critical.category, critical.value)) score.correct++;
    }
    score.werTotal = wordErrorRate(clip.text, transcript).wer;
    if (!failed && Number.isFinite(result?.latencyMs) && (result?.latencyMs ?? -1) >= 0) {
      score.latencies.push(result!.latencyMs!);
    }
  }

  const clusters = [...scores.values()];
  const correct = clusters.reduce((sum, item) => sum + item.correct, 0);
  const total = clusters.reduce((sum, item) => sum + item.total, 0);
  const wer = rate(
    clusters.reduce((sum, item) => sum + item.werTotal, 0),
    clusters.reduce((sum, item) => sum + item.records, 0),
  );
  const latencies = clusters.flatMap((item) => item.latencies);
  const groupSeed = [...`${model}|${split}|${variant}`].reduce(
    (hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0,
    20260925,
  );
  const criticalCi = bootstrapInterval(
    clusters,
    (sample) =>
      rate(
        sample.reduce((sum, item) => sum + item.correct, 0),
        sample.reduce((sum, item) => sum + item.total, 0),
      ),
    groupSeed,
  );
  const werCi = bootstrapInterval(
    clusters,
    (sample) =>
      rate(
        sample.reduce((sum, item) => sum + item.werTotal, 0),
        sample.reduce((sum, item) => sum + item.records, 0),
      ),
    groupSeed + 1,
  );
  const p50 = percentile(latencies, 0.5);
  const p90 = percentile(latencies, 0.9);
  const p50Ci = latencies.length
    ? bootstrapInterval(
        clusters,
        (sample) =>
          percentile(
            sample.flatMap((item) => item.latencies),
            0.5,
          ),
        groupSeed + 2,
      )
    : null;
  const p90Ci = latencies.length
    ? bootstrapInterval(
        clusters,
        (sample) =>
          percentile(
            sample.flatMap((item) => item.latencies),
            0.9,
          ),
        groupSeed + 3,
      )
    : null;
  const errors = clusters.reduce((sum, item) => sum + item.errors, 0);
  const denominator = clusters.reduce((sum, item) => sum + item.records, 0);

  return `| ${model} | ${split} | ${variant} | ${correct}/${total} (${percent(rate(correct, total), criticalCi)}) | ${decimal(wer, werCi)} | ${latency(p50, p50Ci)} | ${latency(p90, p90Ci)} | ${latencies.length}/${denominator} | ${errors} |`;
}

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error('Indiquer le JSON généré par nb-flux-bench.ts');
  const records = JSON.parse(readFileSync(path, 'utf8')) as Result[];
  const lines = [
    '| Modèle | Split | Audio | Infos critiques (IC 95 %) | WER moyen (IC 95 %) | p50 fin de parole→final (IC 95 %) | p90 fin de parole→final (IC 95 %) | Latences valides | Échecs |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const model of MODELS) {
    for (const split of SPLITS) {
      for (const variant of VARIANTS) {
        lines.push(summarize(records, model, split, variant));
      }
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
