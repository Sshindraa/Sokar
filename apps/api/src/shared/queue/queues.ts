import { Queue } from 'bullmq';
import { redisQueue } from '../redis/client';
import { defaultReliableJobOptions, highPriorityWebhookJobOptions } from './job-options';

export const queues = {
  analytics: new Queue('analytics', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  callRecovery: new Queue('call-recovery', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  deadLetter: new Queue('dead-letter', {
    connection: redisQueue,
    defaultJobOptions: { removeOnComplete: 5000, removeOnFail: false },
  }),
  eveningReport: new Queue('evening-report', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  onboarding: new Queue('onboarding', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  reconciliation: new Queue('reconciliation', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  smsManager: new Queue('sms-manager', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  smsClient: new Queue('sms-client', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  telnyxWebhooks: new Queue('telnyx-webhooks', {
    connection: redisQueue,
    defaultJobOptions: highPriorityWebhookJobOptions,
  }),
  connectAnalytics: new Queue('connect-analytics', {
    connection: redisQueue,
    defaultJobOptions: {
      // Best-effort : on perd l'event si Redis tombe, c'est OK pour analytics
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  }),
  confirmationSms: new Queue('confirmation-sms', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  reactivation: new Queue('reactivation', {
    connection: redisQueue,
    defaultJobOptions: defaultReliableJobOptions,
  }),
  googlePlacesSync: new Queue('google-places-sync', {
    connection: redisQueue,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }),
  alertEvaluation: new Queue('alert-evaluation', {
    connection: redisQueue,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed', delay: 10_000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    },
  }),
  idempotencyPurge: new Queue('idempotency-purge', {
    connection: redisQueue,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 },
      removeOnComplete: 30,
      removeOnFail: 100,
    },
  }),
  holdCleanup: new Queue('hold-cleanup', {
    connection: redisQueue,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 30,
      removeOnFail: 100,
    },
  }),
};
