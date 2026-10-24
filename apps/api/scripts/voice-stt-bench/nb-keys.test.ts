import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireBenchCreditBudget, requireBenchKey } from './nb-keys';

afterEach(() => vi.unstubAllEnvs());

describe('voice STT benchmark guards', () => {
  it('rejects a provider key that is the runtime key without revealing it', () => {
    vi.stubEnv('DEEPGRAM_API_KEY', 'runtime-secret');
    vi.stubEnv('DEEPGRAM_BENCH_API_KEY', 'runtime-secret');

    let error: unknown;
    try {
      requireBenchKey('DEEPGRAM_BENCH_API_KEY', 'DEEPGRAM_API_KEY');
    } catch (caught) {
      error = caught;
    }

    expect(String(error)).toContain('identique à DEEPGRAM_API_KEY');
    expect(String(error)).not.toContain('runtime-secret');
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
