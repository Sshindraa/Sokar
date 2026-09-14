import { Worker, type Job } from 'bullmq';
import { MarketingCampaignStatus, type PrismaClient } from '@prisma/client';
import { db } from '../../shared/db/client';
import { queues } from '../../shared/queue/queues';
import { redisQueue } from '../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../shared/queue/workers/helper';
import { evaluateMarketingAutomations } from './marketing-automation.service';

export type MarketingAutomationJobData = {
  kind: 'scan';
  restaurantId?: string;
};

type AutomationWorkerDb = Pick<PrismaClient, 'marketingAutomation' | 'marketingCampaign'>;

export type MarketingAutomationWorkerDependencies = {
  db: AutomationWorkerDb;
  enqueueCampaign: (
    name: string,
    data: { campaignId: string; restaurantId: string },
    options: { jobId: string },
  ) => Promise<unknown>;
  sendsEnabled: boolean;
  now: () => Date;
};

function defaultDependencies(): MarketingAutomationWorkerDependencies {
  return {
    db,
    enqueueCampaign: (name, data, options) => queues.marketingCampaign.add(name, data, options),
    sendsEnabled: process.env.MARKETING_SENDS_ENABLED === 'true',
    now: () => new Date(),
  };
}

function validNow(value: Date): Date {
  if (Number.isNaN(value.getTime())) throw new Error('now must be valid');
  return value;
}

/**
 * Evaluate enabled automations and enqueue any previously-created snapshot
 * campaign. Queueing is deliberately skipped while sends are frozen; the
 * next scan can safely pick up the READY campaign by its durable rows.
 */
export async function processMarketingAutomationJob(
  job: Job<MarketingAutomationJobData>,
  dependencies: MarketingAutomationWorkerDependencies = defaultDependencies(),
): Promise<{ automations: number; campaigns: number; eligible: number; queued: number }> {
  const log = jobLogger(job);
  const now = validNow(dependencies.now());
  const result = await evaluateMarketingAutomations({
    restaurantId: job.data.restaurantId,
    now,
  });
  if (!dependencies.sendsEnabled) {
    return { ...result, queued: 0 };
  }

  const pendingCampaigns = await dependencies.db.marketingCampaign.findMany({
    where: {
      status: MarketingCampaignStatus.READY,
      automationDispatches: { some: {} },
      ...(job.data.restaurantId ? { restaurantId: job.data.restaurantId } : {}),
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 100,
    select: { id: true, restaurantId: true },
  });
  let queued = 0;
  for (const campaign of pendingCampaigns) {
    try {
      await dependencies.enqueueCampaign(
        'send-campaign',
        { campaignId: campaign.id, restaurantId: campaign.restaurantId },
        { jobId: `marketing-campaign:${campaign.id}` },
      );
      queued += 1;
    } catch (error) {
      log.warn(
        {
          campaignId: campaign.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'marketing automation campaign enqueue failed; campaign remains READY',
      );
    }
  }
  return { ...result, queued };
}

export const marketingAutomationWorker = new Worker(
  'marketing-automation',
  (job) => processMarketingAutomationJob(job as Job<MarketingAutomationJobData>),
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(marketingAutomationWorker);
