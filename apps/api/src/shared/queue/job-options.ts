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

export function sanitizeJobId(id: string): string {
  return id.replaceAll(':', '_');
}

export function buildTelnyxWebhookJobId(eventType: string, callControlId: string): string {
  return sanitizeJobId(`telnyx_${eventType}_${callControlId}`);
}

export function buildSmsJobId(kind: string, restaurantId: string, dedupeKey: string): string {
  return sanitizeJobId(`sms_${kind}_${restaurantId}_${dedupeKey}`);
}

export function buildDailyReportJobId(restaurantId: string, dayKey: string): string {
  return sanitizeJobId(`daily-report_${restaurantId}_${dayKey}`);
}

export function buildReconciliationJobId(kind: string, dayKey: string): string {
  return sanitizeJobId(`reconciliation_${kind}_${dayKey}`);
}
