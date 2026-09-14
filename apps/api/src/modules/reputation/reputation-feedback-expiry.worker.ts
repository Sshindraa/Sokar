import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../shared/redis/client';
import { jobLogger, setupWorkerListeners } from '../../shared/queue/workers/helper';
import { expireReputationFeedbackRequests } from './reputation.service';

export interface ReputationFeedbackExpiryJobData {
  readonly limit?: number;
}

export interface ReputationFeedbackExpiryJobResult {
  readonly expired: number;
}

export async function processReputationFeedbackExpiryJob(
  job: Job<ReputationFeedbackExpiryJobData>,
  now = new Date(),
): Promise<ReputationFeedbackExpiryJobResult> {
  const expired = await expireReputationFeedbackRequests({
    now,
    limit: job.data?.limit,
  });
  return { expired };
}

export const reputationFeedbackExpiryWorker = new Worker(
  'reputation-feedback-expiry',
  async (job: Job<ReputationFeedbackExpiryJobData>) => {
    const log = jobLogger(job);
    const result = await processReputationFeedbackExpiryJob(job);
    log.info(result, '[reputation-feedback-expiry] scan complete');
    return result;
  },
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(reputationFeedbackExpiryWorker);
