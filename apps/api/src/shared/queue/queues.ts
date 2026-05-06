import { Queue } from 'bullmq';
import { redisQueue } from '../redis/client';

export const queues = {
  eveningReport: new Queue('evening-report', { connection: redisQueue }),
  smsManager: new Queue('sms-manager', {
    connection:        redisQueue,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
  }),
  smsClient: new Queue('sms-client', {
    connection:        redisQueue,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 50 },
  }),
};
