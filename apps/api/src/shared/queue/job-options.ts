import type { JobsOptions } from 'bullmq';

export const RETRY_BACKOFF_MS = 5_000;

export const defaultReliableJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: RETRY_BACKOFF_MS },
  removeOnComplete: 1000,
  removeOnFail: false,
};

export const highPriorityWebhookJobOptions: JobsOptions = {
  ...defaultReliableJobOptions,
  attempts: 8,
  backoff: { type: 'exponential', delay: 2_000 },
  removeOnComplete: 2000,
};

export function buildTelnyxWebhookJobId(eventType: string, callControlId: string): string {
  return `telnyx:${eventType}:${callControlId}`;
}

export function buildSmsJobId(kind: string, restaurantId: string, dedupeKey: string): string {
  return `sms:${kind}:${restaurantId}:${dedupeKey}`;
}

export function buildDailyReportJobId(restaurantId: string, dayKey: string): string {
  return `daily-report:${restaurantId}:${dayKey}`;
}

export function buildReconciliationJobId(kind: string, dayKey: string): string {
  return `reconciliation:${kind}:${dayKey}`;
}
