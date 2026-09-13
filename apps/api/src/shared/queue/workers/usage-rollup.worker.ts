import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { jobLogger, setupWorkerListeners } from './helper';
import {
  currentMonthKey,
  previousMonthKey,
  rebuildMonthlyRollups,
} from '../../../modules/usage/usage.service';

export interface UsageRollupJobData {
  readonly monthKey?: string;
  readonly restaurantId?: string;
}

/** Rebuilds the usage projection from the immutable ledger. */
export async function processUsageRollupJob(job: Job<UsageRollupJobData>): Promise<void> {
  const log = jobLogger(job);
  const monthKeys = job.data?.monthKey
    ? [job.data.monthKey]
    : [currentMonthKey(), previousMonthKey()];
  const restaurantIds = job.data?.restaurantId
    ? [job.data.restaurantId]
    : (await db.restaurant.findMany({ select: { id: true } })).map(({ id }) => id);

  for (const monthKey of monthKeys) {
    for (const restaurantId of restaurantIds) {
      await rebuildMonthlyRollups(restaurantId, monthKey);
    }
  }
  log.info({ monthKeys, restaurantCount: restaurantIds.length }, '[usage-rollup] rebuild complete');
}

export const usageRollupWorker = new Worker('usage-rollup', processUsageRollupJob, {
  connection: redisQueue,
});

setupWorkerListeners(usageRollupWorker);
