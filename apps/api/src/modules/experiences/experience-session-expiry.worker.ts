import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../shared/redis/client';
import { jobLogger, setupWorkerListeners } from '../../shared/queue/workers/helper';
import { expireExperienceSessions } from './experience.service';

export interface ExperienceSessionExpiryJobData {
  readonly limit?: number;
}

export interface ExperienceSessionExpiryJobResult {
  readonly expired: number;
}

export async function processExperienceSessionExpiryJob(
  job: Job<ExperienceSessionExpiryJobData>,
  now = new Date(),
): Promise<ExperienceSessionExpiryJobResult> {
  const expired = await expireExperienceSessions({ now, limit: job.data?.limit });
  return { expired };
}

export const experienceSessionExpiryWorker = new Worker(
  'experience-session-expiry',
  async (job: Job<ExperienceSessionExpiryJobData>) => {
    const log = jobLogger(job);
    const result = await processExperienceSessionExpiryJob(job);
    log.info(result, '[experience-session-expiry] scan complete');
    return result;
  },
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(experienceSessionExpiryWorker);
