import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { logger } from '../../logger/pino';
import { setupWorkerListeners } from './helper';

export const analyticsWorker = new Worker(
  'analytics',
  async (job) => {
    logger.info({ event: job.data }, '[analytics] onboarding event');
  },
  { connection: redisQueue },
);

setupWorkerListeners(analyticsWorker);
