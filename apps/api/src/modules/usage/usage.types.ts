import type { UsageCategory } from '@prisma/client';

export interface RecordUsageInput {
  readonly restaurantId: string;
  readonly accountId?: string | null;
  readonly category: UsageCategory;
  readonly provider: string;
  readonly quantity: string | number;
  readonly unit: string;
  readonly estimatedCostEur: string | number;
  readonly sourceType: string;
  readonly sourceId: string;
  readonly sourceEventKey: string;
  readonly occurredAt: Date;
  readonly metadata?: Record<string, string | number | boolean | null>;
}

export interface UsageQuantity {
  readonly category: UsageCategory;
  readonly quantity: string;
}
