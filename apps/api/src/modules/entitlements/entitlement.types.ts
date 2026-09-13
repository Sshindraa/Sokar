import type { EntitlementCapability, PlanEntitlements } from '@sokar/config';

export type EffectiveEntitlements = PlanEntitlements & {
  readonly restaurantId: string;
  readonly sourcePlan: string;
  readonly evaluatedAt: string;
};

export interface CapabilityDecision {
  readonly capability: EntitlementCapability;
  readonly allowed: boolean;
  readonly plan: EffectiveEntitlements['id'];
}
