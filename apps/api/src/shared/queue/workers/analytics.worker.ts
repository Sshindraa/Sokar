import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { setupWorkerListeners, jobLogger } from './helper';

export const analyticsWorker = new Worker(
  'analytics',
  async (job) => {
    const log = jobLogger(job);
    log.info({ event: job.data }, '[analytics] onboarding event');
  },
  { connection: redisQueue },
);

setupWorkerListeners(analyticsWorker);
