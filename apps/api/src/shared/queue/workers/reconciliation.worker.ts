import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { setupWorkerListeners, jobLogger } from './helper';

interface ReconciliationJobData {
  readonly kind: 'calls' | 'sms';
  readonly dayKey?: string;
}

function yesterdayKey(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function getDayRange(dayKey = yesterdayKey()): { start: Date; end: Date; dayKey: string } {
  const start = new Date(`${dayKey}T00:00:00.000Z`);
  const end = new Date(`${dayKey}T23:59:59.999Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`Invalid reconciliation dayKey: ${dayKey}`);
  }
  return { start, end, dayKey };
}

export const reconciliationWorker = new Worker(
  'reconciliation',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as ReconciliationJobData;
    const { start, end, dayKey } = getDayRange(data.dayKey);

    if (data.kind === 'calls') {
      const calls = await db.call.findMany({
        where: {
          carrier: 'telnyx',
          createdAt: { gte: start, lte: end },
          OR: [{ durationSec: null }, { outcome: null }],
        },
        select: {
          id: true,
          restaurantId: true,
          callSid: true,
          durationSec: true,
          outcome: true,
          createdAt: true,
        },
        take: 500,
      });

      log.warn(
        {
          dayKey,
          unresolvedCount: calls.length,
          unresolvedCallSids: calls.map((call) => call.callSid).slice(0, 25),
        },
        'call reconciliation completed',
      );
      return;
    }

    log.info({ dayKey }, 'sms reconciliation completed');
  },
  { connection: redisQueue, concurrency: 2 },
);

setupWorkerListeners(reconciliationWorker);
