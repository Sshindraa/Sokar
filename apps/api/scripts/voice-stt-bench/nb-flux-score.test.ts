import { describe, expect, it } from 'vitest';
import { bootstrapInterval, percentile } from './nb-flux-stats';

describe('Flux benchmark statistics', () => {
  it('uses an interpolated empirical percentile', () => {
    expect(percentile([0, 10, 20, 30], 0.5)).toBe(15);
    expect(percentile([0, 10, 20, 30], 0.9)).toBeCloseTo(27);
  });

  it('returns deterministic 95% bootstrap intervals over phrase clusters', () => {
    const clusters = [0, 1, 1, 1, 0];
    const statistic = (sample: readonly number[]) =>
      sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const first = bootstrapInterval(clusters, statistic, 20260925);
    const second = bootstrapInterval(clusters, statistic, 20260925);

    expect(first).toEqual(second);
    expect(first?.lower).toBeLessThanOrEqual(first?.upper ?? 0);
    expect(first?.lower).toBeGreaterThanOrEqual(0);
    expect(first?.upper).toBeLessThanOrEqual(1);
  });
});
