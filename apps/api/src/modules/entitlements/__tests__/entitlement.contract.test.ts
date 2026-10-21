import { describe, expect, it } from 'vitest';
import {
  ENTITLEMENT_CAPABILITIES,
  PLAN_ENTITLEMENTS,
  hasPlanCapability,
  normalizeCommercialPlan,
} from '@sokar/config';
import { isRuntimeFlagEnabled, isRuntimeFlagEnabledForRestaurant } from '../entitlement.guard';

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

  it('opens a production runtime flag for listed restaurants only', () => {
    const env = { NODE_ENV: 'production', CRM_ADVANCED_RESTAURANT_IDS: 'r-2, r-1' };
    const open = (restaurantId: string | undefined, environment: NodeJS.ProcessEnv = env) =>
      isRuntimeFlagEnabledForRestaurant(
        'CRM_ADVANCED_ENABLED',
        'CRM_ADVANCED_RESTAURANT_IDS',
        restaurantId,
        environment,
      );
    expect(open('r-1')).toBe(true);
    expect(open('r-3')).toBe(false);
    expect(open(undefined)).toBe(false);
    expect(open('r-1', { NODE_ENV: 'production' })).toBe(false);
    expect(
      open('r-1', {
        NODE_ENV: 'production',
        CRM_ADVANCED_ENABLED: 'false',
        CRM_ADVANCED_RESTAURANT_IDS: 'r-1',
      }),
    ).toBe(true);
    expect(open('r-3', { NODE_ENV: 'production', CRM_ADVANCED_ENABLED: 'true' })).toBe(true);
  });

  it('fails closed for an absent production runtime flag', () => {
    expect(isRuntimeFlagEnabled('CRM_ADVANCED_ENABLED', { NODE_ENV: 'production' })).toBe(false);
    expect(
      isRuntimeFlagEnabled('CRM_ADVANCED_ENABLED', {
        NODE_ENV: 'production',
        CRM_ADVANCED_ENABLED: 'true',
      }),
    ).toBe(true);
    expect(isRuntimeFlagEnabled('CRM_ADVANCED_ENABLED', { NODE_ENV: 'test' })).toBe(true);
  });
});
