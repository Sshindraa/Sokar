/**
 * Commercial capabilities are decided here and enforced by the API.
 *
 * A capability means that the customer's plan is allowed to use a feature.
 * Runtime availability (provider configured, rollout flag, health) remains a
 * separate concern and must also be checked by the feature itself.
 */
export const ENTITLEMENT_CAPABILITIES = [
  'voice.inbound',
  'reservations.manage',
  'floorPlan.manage',
  'widget.publish',
  'customers.basic',
  'customers.advanced',
  'analytics.basic',
  'agenticReservations.publish',
  'customers.vipRecognition',
  'reactivation.manage',
  'marketing.segments',
  'marketing.campaigns',
  'marketing.automations',
  'marketing.attribution',
  'crm.merge',
  'pos.connect',
  'reservations.payments',
  'customers.group',
  'reputation.feedback',
  'reputation.loyalty',
  'experiences.manage',
  'events.manage',
  'distribution.manage',
  'support.priority',
  'account.multiSite',
] as const;

export type EntitlementCapability = (typeof ENTITLEMENT_CAPABILITIES)[number];

export const COMMERCIAL_PLAN_IDS = ['essential', 'pro', 'multi-site'] as const;
export type CommercialPlanId = (typeof COMMERCIAL_PLAN_IDS)[number];

export type DatabasePlanCode = 'ESSENTIAL' | 'STARTER' | 'PRO' | 'PREMIUM';

export interface PlanUsageLimits {
  /** null means that no customer usage quota is enforced. */
  readonly voiceMinutesMonthly: number | null;
  readonly smsMonthly: number | null;
  readonly sites: number;
  readonly users: number | null;
}

export interface PlanEntitlements {
  readonly id: CommercialPlanId;
  readonly label: string;
  readonly capabilities: Readonly<Record<EntitlementCapability, boolean>>;
  readonly limits: PlanUsageLimits;
  readonly supportLevel: 'standard' | 'priority';
}

const ESSENTIAL_CAPABILITIES: Readonly<Record<EntitlementCapability, boolean>> = {
  'voice.inbound': true,
  'reservations.manage': true,
  'floorPlan.manage': true,
  'widget.publish': true,
  'customers.basic': true,
  'customers.advanced': false,
  'analytics.basic': true,
  'agenticReservations.publish': true,
  'customers.vipRecognition': false,
  'reactivation.manage': false,
  'marketing.segments': false,
  'marketing.campaigns': false,
  'marketing.automations': false,
  'marketing.attribution': false,
  'crm.merge': false,
  'pos.connect': false,
  'reservations.payments': false,
  'customers.group': false,
  'reputation.feedback': false,
  'reputation.loyalty': false,
  'experiences.manage': false,
  'events.manage': false,
  'distribution.manage': false,
  'support.priority': false,
  'account.multiSite': false,
};

const PRO_CAPABILITIES: Readonly<Record<EntitlementCapability, boolean>> = {
  ...ESSENTIAL_CAPABILITIES,
  'customers.vipRecognition': true,
  'customers.advanced': true,
  'reactivation.manage': true,
  'marketing.segments': true,
  'marketing.campaigns': true,
  'marketing.automations': true,
  'marketing.attribution': true,
  'crm.merge': true,
  'pos.connect': true,
  'reservations.payments': true,
  'customers.group': false,
  'reputation.feedback': true,
  'reputation.loyalty': true,
  'experiences.manage': true,
  'events.manage': true,
  'distribution.manage': true,
  'support.priority': true,
};

export const PLAN_ENTITLEMENTS: Readonly<Record<CommercialPlanId, PlanEntitlements>> = {
  essential: {
    id: 'essential',
    label: 'Essential',
    capabilities: ESSENTIAL_CAPABILITIES,
    limits: {
      voiceMinutesMonthly: null,
      smsMonthly: null,
      sites: 1,
      users: null,
    },
    supportLevel: 'standard',
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    capabilities: PRO_CAPABILITIES,
    limits: {
      voiceMinutesMonthly: null,
      smsMonthly: null,
      sites: 1,
      users: null,
    },
    supportLevel: 'priority',
  },
  'multi-site': {
    id: 'multi-site',
    label: 'Multi-site',
    capabilities: {
      ...PRO_CAPABILITIES,
      'account.multiSite': true,
      'customers.group': true,
    },
    limits: {
      voiceMinutesMonthly: null,
      smsMonthly: null,
      sites: 100,
      users: null,
    },
    supportLevel: 'priority',
  },
};

export function normalizeCommercialPlan(plan: string): CommercialPlanId | null {
  switch (plan.toUpperCase()) {
    case 'ESSENTIAL':
    case 'STARTER':
      return 'essential';
    case 'PRO':
      return 'pro';
    case 'PREMIUM':
      return 'multi-site';
    default:
      return null;
  }
}

export function hasPlanCapability(
  plan: CommercialPlanId,
  capability: EntitlementCapability,
): boolean {
  return PLAN_ENTITLEMENTS[plan].capabilities[capability];
}
