import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../shared/redis/client';
import { jobLogger, setupWorkerListeners } from '../../shared/queue/workers/helper';
import { expireLoyaltyGrants } from './loyalty.service';

export interface LoyaltyGrantExpiryJobData {
  readonly limit?: number;
}

export interface LoyaltyGrantExpiryJobResult {
  readonly expired: number;
}

export async function processLoyaltyGrantExpiryJob(
  job: Job<LoyaltyGrantExpiryJobData>,
  now = new Date(),
): Promise<LoyaltyGrantExpiryJobResult> {
  const expired = await expireLoyaltyGrants({ now, limit: job.data?.limit });
  return { expired };
}

export const loyaltyGrantExpiryWorker = new Worker(
  'loyalty-grant-expiry',
  async (job: Job<LoyaltyGrantExpiryJobData>) => {
    const log = jobLogger(job);
    const result = await processLoyaltyGrantExpiryJob(job);
    log.info(result, '[loyalty-grant-expiry] scan complete');
    return result;
  },
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(loyaltyGrantExpiryWorker);
