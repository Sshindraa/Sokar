import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_CAPABILITIES,
  PLAN_ENTITLEMENTS,
  hasPlanCapability,
  normalizeCommercialPlan,
} from '@sokar/config';

describe('entitlement contract', () => {
  it('defines every capability for every commercial plan', () => {
    for (const plan of Object.values(PLAN_ENTITLEMENTS)) {
      expect(Object.keys(plan.capabilities).sort()).toEqual([...ENTITLEMENT_CAPABILITIES].sort());
    }
  });

  it('normalizes current and legacy database plan codes', () => {
    expect(normalizeCommercialPlan('ESSENTIAL')).toBe('essential');
    expect(normalizeCommercialPlan('STARTER')).toBe('essential');
    expect(normalizeCommercialPlan('PRO')).toBe('pro');
    expect(normalizeCommercialPlan('PREMIUM')).toBe('multi-site');
    expect(normalizeCommercialPlan('unknown')).toBeNull();
  });

  it('keeps plan upgrades monotonic for shared capabilities', () => {
    for (const capability of ENTITLEMENT_CAPABILITIES) {
      if (hasPlanCapability('essential', capability)) {
        expect(hasPlanCapability('pro', capability), capability).toBe(true);
      }
      if (hasPlanCapability('pro', capability)) {
        expect(hasPlanCapability('multi-site', capability), capability).toBe(true);
      }
    }
  });
});
