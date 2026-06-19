import { describe, it, expect } from 'vitest';
import {
  PLAN_VALUES,
  PLAN_LABELS,
  PLAN_PRICES_EUR,
  PLAN_LEGACY,
  type Plan,
} from '../plan';

describe('plan', () => {
  it('every Plan type is in PLAN_VALUES', () => {
    // Compile-time check: this assignment only compiles if every value is valid
    const allPlans: Plan[] = PLAN_VALUES;
    expect(allPlans).toHaveLength(4);
  });

  it('every plan has a label, price, and legacy flag (no missing keys)', () => {
    for (const p of PLAN_VALUES) {
      expect(PLAN_LABELS[p], `label missing for ${p}`).toBeTypeOf('string');
      expect(PLAN_PRICES_EUR[p], `price missing for ${p}`).toBeDefined();
      expect(PLAN_LEGACY[p], `legacy flag missing for ${p}`).toBeTypeOf('boolean');
    }
  });

  it('legacy plan (STARTER) is marked legacy and labelled like ESSENTIAL', () => {
    expect(PLAN_LEGACY.STARTER).toBe(true);
    expect(PLAN_LEGACY.ESSENTIAL).toBe(false);
    expect(PLAN_LABELS.STARTER).toBe(PLAN_LABELS.ESSENTIAL);
  });
});
