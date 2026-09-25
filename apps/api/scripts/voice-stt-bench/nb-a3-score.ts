import { readFileSync } from 'node:fs';
import {
  ALL_CATEGORIES,
  NB_A3_CALIBRATION_IDS,
  NB_A3_CORPUS,
  type CriticalCategory,
} from './nb-corpus';
import { containsNormalizedPhrase, digitSequence, wordErrorRate } from './nb-normalize';
import { bootstrapInterval, percentile } from './nb-flux-stats';

type AudioPath = 'PCMA_8k' | 'L16_16k';
type Variant = 'clean' | 'noisy';
type Split = 'calibration' | 'validation';
type KeytermSet = 'current' | 'generated';

interface Result {
  audioPath: AudioPath;
  clipId: string;
  split: Split;
  variant: Variant;
  numerals: boolean;
  punctuate: boolean;
  keytermSet: KeytermSet;
  transcript: string;
  error: string | null;
  latencyMs: number | null;
}

interface ClipScore {
  clipId: string;
  correct: number;
  total: number;
  categories: Map<CriticalCategory, [number, number]>;
  wer: number;
  latencyMs: number | null;
  failed: boolean;
}

function splitForClip(clipId: string): Split {
  return NB_A3_CALIBRATION_IDS.has(clipId) ? 'calibration' : 'validation';
}

function criticalMatches(transcript: string, category: CriticalCategory, value: string): boolean {
  if (category === 'telephone') return digitSequence(transcript).includes(value);
  return containsNormalizedPhrase(transcript, value);
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

function summarizeCell(
  records: Result[],
  key: Omit<Result, 'clipId' | 'transcript' | 'error' | 'latencyMs' | 'split'>,
  split: Split,
): string {
  const clips = NB_A3_CORPUS.filter((clip) => splitForClip(clip.id) === split);
  const matching = records.filter(
    (record) =>
      record.audioPath === key.audioPath &&
      record.variant === key.variant &&
      record.numerals === key.numerals &&
      record.punctuate === key.punctuate &&
      record.keytermSet === key.keytermSet &&
      record.split === split,
  );
  const byClip = new Map(matching.map((record) => [record.clipId, record]));
  const scores: ClipScore[] = clips.map((clip) => {
    const result = byClip.get(clip.id);
    const failed = !result || Boolean(result.error) || !result.transcript.trim();
    const transcript = failed ? '' : result!.transcript;
    const categories = new Map<CriticalCategory, [number, number]>();
    let correct = 0;
    for (const category of ALL_CATEGORIES) categories.set(category, [0, 0]);
    for (const info of clip.critical) {
      const counts = categories.get(info.category)!;
      counts[1]++;
      if (criticalMatches(transcript, info.category, info.value)) {
        correct++;
        counts[0]++;
      }
    }
    return {
      clipId: clip.id,
      correct,
      total: clip.critical.length,
      categories,
      wer: wordErrorRate(clip.text, transcript).wer,
      latencyMs: !failed && Number.isFinite(result?.latencyMs) ? result!.latencyMs : null,
      failed,
    };
  });

  const seed = [...`${JSON.stringify(key)}|${split}`].reduce(
    (value, char) => (Math.imul(value, 31) + char.charCodeAt(0)) >>> 0,
    20260925,
  );
  const criticalRate = (sample: readonly ClipScore[]) =>
    sample.reduce((sum, score) => sum + score.correct, 0) /
    Math.max(
      1,
      sample.reduce((sum, score) => sum + score.total, 0),
    );
  const criticalCi = bootstrapInterval(scores, criticalRate, seed);
  const wer = scores.reduce((sum, score) => sum + score.wer, 0) / Math.max(1, scores.length);
  const werCi = bootstrapInterval(
    scores,
    (sample) => sample.reduce((sum, score) => sum + score.wer, 0) / Math.max(1, sample.length),
    seed + 1,
  );
  const latencies = scores.flatMap((score) => (score.latencyMs === null ? [] : [score.latencyMs]));
  const p50 = percentile(latencies, 0.5);
  const p90 = percentile(latencies, 0.9);
  const p50Ci = latencies.length
    ? bootstrapInterval(
        scores,
        (sample) =>
          percentile(
            sample.flatMap((score) => (score.latencyMs === null ? [] : [score.latencyMs])),
            0.5,
          ),
        seed + 2,
      )
    : null;
  const p90Ci = latencies.length
    ? bootstrapInterval(
        scores,
        (sample) =>
          percentile(
            sample.flatMap((score) => (score.latencyMs === null ? [] : [score.latencyMs])),
            0.9,
          ),
        seed + 3,
      )
    : null;
  const totalCritical = scores.reduce((sum, score) => sum + score.total, 0);
  const correctCritical = scores.reduce((sum, score) => sum + score.correct, 0);
  const categories = ALL_CATEGORIES.map((category) => {
    const counts = scores.reduce(
      (sum, score) => {
        const [correct, total] = score.categories.get(category)!;
        return [sum[0] + correct, sum[1] + total] as [number, number];
      },
      [0, 0] as [number, number],
    );
    const ci = bootstrapInterval(
      scores,
      (sample) => {
        const denominator = sample.reduce(
          (sum, score) => sum + score.categories.get(category)![1],
          0,
        );
        const numerator = sample.reduce(
          (sum, score) => sum + score.categories.get(category)![0],
          0,
        );
        return denominator ? numerator / denominator : Number.NaN;
      },
      seed + 10 + ALL_CATEGORIES.indexOf(category),
    );
    return `${category} ${percent(counts[1] ? counts[0] / counts[1] : 0, ci)}`;
  });
  const errors = scores.filter((score) => score.failed).length;
  const p50Text = Number.isFinite(p50) ? `${Math.round(p50)} ms` : '—';
  const p50Cell = p50Ci
    ? `${p50Text} [${Math.round(p50Ci.lower)}–${Math.round(p50Ci.upper)}]`
    : p50Text;
  const p90Text = Number.isFinite(p90) ? `${Math.round(p90)} ms` : '—';
  const p90Cell = p90Ci
    ? `${p90Text} [${Math.round(p90Ci.lower)}–${Math.round(p90Ci.upper)}]`
    : p90Text;
  return `| ${key.audioPath} | ${key.variant} | ${key.numerals ? 'on' : 'off'} | ${key.punctuate ? 'on' : 'off'} | ${key.keytermSet} | ${split} | ${correctCritical}/${totalCritical} ${percent(totalCritical ? correctCritical / totalCritical : 0, criticalCi)} | ${categories.join('<br>')} | ${decimal(wer, werCi)} | ${p50Cell} | ${p90Cell} | ${errors}/${clips.length} |`;
}

function main(): void {
  const path = process.argv[2];
  if (!path) throw new Error('Indiquer le JSON du run A3');
  const records = JSON.parse(readFileSync(path, 'utf8')) as Result[];
  const settings: Array<Omit<Result, 'clipId' | 'transcript' | 'error' | 'latencyMs' | 'split'>> =
    [];
  for (const numerals of [true, false]) {
    for (const punctuate of [true, false]) {
      for (const keytermSet of ['current', 'generated'] as const) {
        settings.push({ audioPath: 'PCMA_8k', variant: 'clean', numerals, punctuate, keytermSet });
        settings.push({ audioPath: 'PCMA_8k', variant: 'noisy', numerals, punctuate, keytermSet });
      }
    }
  }
  for (const keytermSet of ['current', 'generated'] as const) {
    settings.push({
      audioPath: 'L16_16k',
      variant: 'clean',
      numerals: true,
      punctuate: false,
      keytermSet,
    });
    settings.push({
      audioPath: 'L16_16k',
      variant: 'noisy',
      numerals: true,
      punctuate: false,
      keytermSet,
    });
  }

  const lines = [
    '| Chemin | Audio | numerals | punctuate | keyterms | Split | Infos critiques (IC 95 %) | Catégories (IC 95 %) | WER (IC 95 %) | p50 fin de parole→final (IC 95 %) | p90 fin de parole→final (IC 95 %) | Erreurs |',
    '|---|---|---|---|---|---|---:|---|---:|---:|---:|---:|',
  ];
  for (const key of settings) {
    for (const split of ['calibration', 'validation'] as const) {
      lines.push(summarizeCell(records, key, split));
    }
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
