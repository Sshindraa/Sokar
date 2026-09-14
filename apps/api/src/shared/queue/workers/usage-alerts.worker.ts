import { Worker, type Job } from 'bullmq';
import { redisQueue, redisCache } from '../../redis/client';
import { db } from '../../db/client';
import { jobLogger, setupWorkerListeners } from './helper';
import { logger } from '../../logger/pino';
import { dispatchAlert } from '../../observability/alert-dispatcher';
import { currentMonthKey, getCurrentUsage } from '../../../modules/usage/usage.service';
import {
  getInternalUsageAlertBudgets,
  type InternalUsageAlertBudgets,
} from '../../../modules/usage/usage-alert-budget.service';
import {
  evaluateUsageThresholds,
  usageAlertClaimKey,
  type UsageThresholdAlert,
} from '../../../modules/usage/usage-alerts.service';

export interface UsageAlertsJobData {
  readonly monthKey?: string;
  readonly restaurantId?: string;
}

export interface UsageAlertsWorkerDependencies {
  readonly db: typeof db;
  readonly claimStore: Pick<typeof redisCache, 'set'>;
  readonly getUsage: typeof getCurrentUsage;
  readonly getBudgets: () => InternalUsageAlertBudgets;
  readonly dispatch: typeof dispatchAlert;
  readonly enabled: boolean;
  readonly now?: () => Date;
}

export interface UsageAlertsJobResult {
  readonly monthKey: string;
  readonly restaurants: number;
  readonly evaluated: number;
  readonly crossed: number;
  readonly dispatched: number;
  readonly skipped: number;
  readonly disabled: boolean;
}

const CLAIM_TTL_SECONDS = 45 * 24 * 60 * 60;

async function claimMilestone(
  store: Pick<typeof redisCache, 'set'>,
  key: string,
): Promise<boolean> {
  try {
    return (await store.set(key, '1', 'EX', CLAIM_TTL_SECONDS, 'NX')) === 'OK';
  } catch (error) {
    // Without a durable claim, sending would be repeated on every hourly
    // scan. Failing closed protects restaurants from alert spam.
    logger.warn({ err: error, claimKey: key }, '[usage-alerts] claim store unavailable');
    return false;
  }
}

function alertPayload(
  restaurantId: string,
  monthKey: string,
  alert: UsageThresholdAlert,
): Parameters<typeof dispatchAlert>[0] {
  const label = alert.metric === 'voiceMinutes' ? 'minutes de voix' : 'segments SMS';
  const amount = `${alert.used}/${alert.included} ${label}`;
  return {
    kind: `usage_quota_${alert.metric}_${alert.threshold}`,
    severity: alert.severity,
    summary: `Seuil de suivi interne (${label}) à ${alert.threshold} %`,
    detail: [
      'scope=internal-operations',
      `restaurantId=${restaurantId}`,
      `month=${monthKey}`,
      `usage=${amount}`,
      `percentage=${alert.percentage}%`,
      `threshold=${alert.threshold}%`,
    ].join('\n'),
  };
}

export async function processUsageAlertsJob(
  job: Job<UsageAlertsJobData>,
  dependencies: UsageAlertsWorkerDependencies = {
    db,
    claimStore: redisCache,
    getUsage: getCurrentUsage,
    getBudgets: getInternalUsageAlertBudgets,
    dispatch: dispatchAlert,
    enabled: process.env.USAGE_ALERTS_ENABLED === 'true',
  },
): Promise<UsageAlertsJobResult> {
  const monthKey = job.data?.monthKey ?? currentMonthKey(dependencies.now?.() ?? new Date());
  if (!dependencies.enabled) {
    return {
      monthKey,
      restaurants: 0,
      evaluated: 0,
      crossed: 0,
      dispatched: 0,
      skipped: 0,
      disabled: true,
    };
  }

  const restaurants = job.data?.restaurantId
    ? [{ id: job.data.restaurantId }]
    : await dependencies.db.restaurant.findMany({ select: { id: true } });
  let evaluated = 0;
  let crossed = 0;
  let dispatched = 0;
  let skipped = 0;

  for (const restaurant of restaurants) {
    const usage = await dependencies.getUsage(restaurant.id, monthKey);
    const alerts = evaluateUsageThresholds({ usage, limits: dependencies.getBudgets() });
    evaluated++;
    crossed += alerts.length;

    for (const alert of alerts) {
      const claimKey = usageAlertClaimKey(monthKey, restaurant.id, alert);
      if (!(await claimMilestone(dependencies.claimStore, claimKey))) {
        skipped++;
        continue;
      }
      await dependencies.dispatch(alertPayload(restaurant.id, monthKey, alert));
      dispatched++;
    }
  }

  return {
    monthKey,
    restaurants: restaurants.length,
    evaluated,
    crossed,
    dispatched,
    skipped,
    disabled: false,
  };
}

export const usageAlertsWorker = new Worker(
  'usage-alerts',
  async (job: Job<UsageAlertsJobData>) => {
    const log = jobLogger(job);
    const result = await processUsageAlertsJob(job);
    log.info(result, '[usage-alerts] scan complete');
    return result;
  },
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(usageAlertsWorker);
