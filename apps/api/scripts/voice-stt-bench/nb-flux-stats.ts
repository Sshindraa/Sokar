import { mulberry32 } from './nb-dsp';

export interface ConfidenceInterval {
  lower: number;
  upper: number;
}

export function percentile(values: readonly number[], quantile: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(1, quantile)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** Deterministic percentile bootstrap, resampling independent phrase clusters. */
export function bootstrapInterval<T>(
  clusters: readonly T[],
  statistic: (sample: readonly T[]) => number,
  seed: number,
  iterations = 2_000,
): ConfidenceInterval | null {
  if (!clusters.length || iterations < 1) return null;
  const random = mulberry32(seed);
  const estimates: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    const sample = Array.from(
      { length: clusters.length },
      () => clusters[Math.floor(random() * clusters.length)],
    );
    const estimate = statistic(sample);
    if (Number.isFinite(estimate)) estimates.push(estimate);
  }
  if (!estimates.length) return null;
  return {
    lower: percentile(estimates, 0.025),
    upper: percentile(estimates, 0.975),
  };
}
