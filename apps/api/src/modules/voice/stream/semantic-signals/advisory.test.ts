import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyClarifyAdvisory, clarifyAdvisoryThreshold } from './advisory';

const signals = (present: number) => ({
  needs_clarification: { present, absent: 1 - present, notObservable: 0 },
});

describe('clarify advisory', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('range chaque tour selon Jev et l’agent', () => {
    expect(classifyClarifyAdvisory(signals(0.9), 'unclear')).toBe('both');
    expect(classifyClarifyAdvisory(signals(0.9), 'answer')).toBe('jev_only');
    expect(classifyClarifyAdvisory(signals(0.2), 'unclear')).toBe('agent_only');
    expect(classifyClarifyAdvisory(signals(0.2), 'answer')).toBe('neither');
  });

  it('ne classe rien sans score Jev ni interprétation de l’agent', () => {
    expect(classifyClarifyAdvisory({}, 'answer')).toBeNull();
    expect(classifyClarifyAdvisory(signals(0.9), undefined)).toBeNull();
  });

  it('suit le seuil configuré, borné à ]0, 1[', () => {
    vi.stubEnv('VOICE_SEMANTIC_ADVISORY_CLARIFY_THRESHOLD', '0.6');
    expect(clarifyAdvisoryThreshold()).toBe(0.6);
    expect(classifyClarifyAdvisory(signals(0.7), 'answer')).toBe('jev_only');
    vi.stubEnv('VOICE_SEMANTIC_ADVISORY_CLARIFY_THRESHOLD', '2');
    expect(clarifyAdvisoryThreshold()).toBe(0.8);
  });
});
