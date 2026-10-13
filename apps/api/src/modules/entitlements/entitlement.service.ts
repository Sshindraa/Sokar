import {
  PLAN_ENTITLEMENTS,
  normalizeCommercialPlan,
  type EntitlementCapability,
} from '@sokar/config';
import { db } from '../../shared/db/client';
import { getRestaurantPlanOverride } from '../../shared/configcat';
import type { CapabilityDecision, EffectiveEntitlements } from './entitlement.types';

export class EntitlementRestaurantNotFoundError extends Error {
  readonly code = 'RESTAURANT_NOT_FOUND';

  constructor() {
    super('Restaurant not found');
    this.name = 'EntitlementRestaurantNotFoundError';
  }
}

export class EntitlementPlanInvalidError extends Error {
  readonly code = 'ENTITLEMENT_PLAN_INVALID';

  constructor(readonly sourcePlan: string) {
    super(`Unsupported entitlement plan: ${sourcePlan}`);
    this.name = 'EntitlementPlanInvalidError';
  }
}

export async function getEffectiveEntitlements(
  restaurantId: string,
): Promise<EffectiveEntitlements> {
  const restaurant = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { plan: true, serviceCopilotLegacyAccess: true },
  });
  if (!restaurant) throw new EntitlementRestaurantNotFoundError();

  const sourcePlan = await getRestaurantPlanOverride(restaurantId, restaurant.plan);
  const commercialPlan = normalizeCommercialPlan(sourcePlan);
  if (!commercialPlan) throw new EntitlementPlanInvalidError(sourcePlan);

  return {
    ...PLAN_ENTITLEMENTS[commercialPlan],
    capabilities: {
      ...PLAN_ENTITLEMENTS[commercialPlan].capabilities,
      'floorPlan.copilot':
        PLAN_ENTITLEMENTS[commercialPlan].capabilities['floorPlan.copilot'] ||
        restaurant.serviceCopilotLegacyAccess === true,
    },
    restaurantId,
    sourcePlan,
    evaluatedAt: new Date().toISOString(),
  };
}

export async function evaluateCapability(
  restaurantId: string,
  capability: EntitlementCapability,
): Promise<CapabilityDecision> {
  const entitlements = await getEffectiveEntitlements(restaurantId);
  return {
    capability,
    allowed: entitlements.capabilities[capability],
    plan: entitlements.id,
  };
}
