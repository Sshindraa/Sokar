import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireBenchCreditBudget, requireBenchKey } from './nb-keys';

afterEach(() => vi.unstubAllEnvs());

describe('voice STT benchmark guards', () => {
  it('accepts the runtime key as an explicit bench key', () => {
    vi.stubEnv('DEEPGRAM_API_KEY', 'runtime-secret');
    vi.stubEnv('DEEPGRAM_BENCH_API_KEY', 'runtime-secret');
    expect(requireBenchKey('DEEPGRAM_BENCH_API_KEY', 'DEEPGRAM_API_KEY')).toBe('runtime-secret');
  });

  it('falls back to the runtime key when the bench key is absent or blank', () => {
    vi.stubEnv('CARTESIA_API_KEY', 'runtime-secret');
    for (const value of [undefined, '   ']) {
      vi.stubEnv('CARTESIA_BENCH_API_KEY', value);
      expect(requireBenchKey('CARTESIA_BENCH_API_KEY', 'CARTESIA_API_KEY')).toBe('runtime-secret');
    }
  });

  it('rejects missing keys without exposing credentials', () => {
    vi.stubEnv('DEEPGRAM_API_KEY', '');
    vi.stubEnv('DEEPGRAM_BENCH_API_KEY', '');
    expect(() => requireBenchKey('DEEPGRAM_BENCH_API_KEY', 'DEEPGRAM_API_KEY')).toThrow(
      'DEEPGRAM_BENCH_API_KEY ou DEEPGRAM_API_KEY est requis',
    );
  });

  it('accepts a dedicated Cartesia bench key', () => {
    vi.stubEnv('CARTESIA_API_KEY', 'runtime-secret');
    vi.stubEnv('CARTESIA_BENCH_API_KEY', 'bench-secret');

    expect(requireBenchKey('CARTESIA_BENCH_API_KEY', 'CARTESIA_API_KEY')).toBe('bench-secret');
  });

  it('requires an explicit Cartesia credits ceiling that covers the estimate', () => {
    vi.stubEnv('BENCH_MAX_CREDITS', '120');

    expect(requireBenchCreditBudget(90)).toBe(120);
    expect(() => requireBenchCreditBudget(121)).toThrow(/Budget Cartesia dépassé/);
    vi.stubEnv('BENCH_MAX_CREDITS', '');
    expect(() => requireBenchCreditBudget(10)).toThrow(/BENCH_MAX_CREDITS/);
  });
});
