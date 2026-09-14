import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { db } from '../../shared/db/client';
import { redisQueue } from '../../shared/redis/client';
import { jobLogger, setupWorkerListeners } from '../../shared/queue/workers/helper';
import {
  reconcileMarketingProviderEvents,
  type MarketingProvider,
  type MarketingProviderReconciliationSummary,
} from './marketing-provider.service';

export type MarketingProviderReconciliationJobData = {
  provider?: MarketingProvider;
  restaurantId?: string;
  limit?: number;
};

export type MarketingProviderReconciliationWorkerDependencies = {
  db: PrismaClient;
  reconcile: (args: {
    provider?: MarketingProvider;
    restaurantId?: string;
    limit?: number;
    database: PrismaClient;
    now: Date;
  }) => Promise<MarketingProviderReconciliationSummary>;
  now: () => Date;
};

function defaultDependencies(): MarketingProviderReconciliationWorkerDependencies {
  return {
    db,
    reconcile: reconcileMarketingProviderEvents,
    now: () => new Date(),
  };
}

function boundedLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.trunc(value as number), 1), 500);
}

/** Reconciles callbacks durably captured before their CampaignMessage existed. */
export async function processMarketingProviderReconciliationJob(
  job: Job<MarketingProviderReconciliationJobData>,
  dependencies: MarketingProviderReconciliationWorkerDependencies = defaultDependencies(),
): Promise<MarketingProviderReconciliationSummary> {
  const now = dependencies.now();
  if (Number.isNaN(now.getTime())) throw new Error('now must be valid');
  const result = await dependencies.reconcile({
    provider: job.data.provider,
    restaurantId: job.data.restaurantId,
    limit: boundedLimit(job.data.limit),
    database: dependencies.db,
    now,
  });
  jobLogger(job).info(result, 'marketing provider reconciliation completed');
  return result;
}

export const marketingProviderReconciliationWorker = new Worker(
  'marketing-provider-reconciliation',
  (job) =>
    processMarketingProviderReconciliationJob(job as Job<MarketingProviderReconciliationJobData>),
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(marketingProviderReconciliationWorker);
