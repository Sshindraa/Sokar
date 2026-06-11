import { Queue } from 'bullmq';
import { redisQueue } from '../redis/client';

export const queues = {
  analytics: new Queue('analytics', {
    connection: redisQueue,
    defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 200 },
  }),
  eveningReport: new Queue('evening-report', { connection: redisQueue }),
  onboarding: new Queue('onboarding', {
    connection: redisQueue,
    defaultJobOptions: { removeOnComplete: 200, removeOnFail: 100 },
  }),
  smsManager: new Queue('sms-manager', {
    connection: redisQueue,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
  }),
  smsClient: new Queue('sms-client', {
    connection: redisQueue,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
  }),
};
