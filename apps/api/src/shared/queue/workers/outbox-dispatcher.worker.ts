import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { queues } from '../queues';
import { db } from '../../db/client';
import { sanitizeJobId } from '../job-options';
import { jobLogger, setupWorkerListeners } from './helper';
import {
  claimPending,
  recoverExpiredLeases,
  markDispatched,
  releaseForRetry,
} from '../../outbox/outbox.service';

export interface OutboxDispatchJobData {
  readonly limit?: number;
}

async function retryFailedNotifications(log: ReturnType<typeof jobLogger>): Promise<void> {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let offset = 0;
  let retried = 0;
  while (retried < 50) {
    const jobs = await queues.outboxDelivery.getJobs(['failed'], offset, offset + 49, true);
    if (!jobs.length) break;
    let moved = 0;
    for (const job of jobs) {
      if (!job.finishedOn || job.finishedOn > cutoff || !job.data?.outboxEventId) continue;
      // tenant-scoping: global — tâche système par ID d'événement interne.
      const event = await db.outboxEvent.findUnique({
        where: { id: job.data.outboxEventId },
        select: { topic: true },
      });
      if (
        !event ||
        ![
          'reservation-confirmation',
          'reservation-confirmation-email',
          'gift-card-delivery',
          'reputation-feedback-email',
        ].includes(event.topic)
      )
        continue;
      try {
        await job.retry('failed');
        moved++;
        retried++;
      } catch (err) {
        log.warn({ err, jobId: job.id }, 'outbox retry failed');
      }
    }
    offset += jobs.length - moved;
    if (jobs.length < 50) break;
  }
  offset = 0;
  retried = 0;
  while (retried < 50) {
    const jobs = await queues.smsClient.getJobs(['failed'], offset, offset + 49, true);
    if (!jobs.length) break;
    let moved = 0;
    for (const job of jobs) {
      if (job.name === 'client-confirm' && job.finishedOn && job.finishedOn <= cutoff) {
        try {
          await job.retry('failed');
          moved++;
          retried++;
        } catch (err) {
          log.warn({ err, jobId: job.id }, 'SMS retry failed');
        }
      }
    }
    offset += jobs.length - moved;
    if (jobs.length < 50) break;
  }
}

/** Publish claimed Postgres events to a durable BullMQ delivery queue. */
export async function processOutboxDispatchJob(job: Job<OutboxDispatchJobData>): Promise<void> {
  const log = jobLogger(job);
  const recovered = await recoverExpiredLeases();
  if (recovered > 0) log.warn({ recovered }, '[outbox] expired leases requeued');

  const events = await claimPending(job.data?.limit);
  let failed = 0;
  for (const event of events) {
    try {
      await queues.outboxDelivery.add(
        'deliver',
        { outboxEventId: event.id },
        {
          jobId: sanitizeJobId(`outbox_delivery_${event.id}`),
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      );
      await markDispatched(event.id);
    } catch (error) {
      failed++;
      await releaseForRetry(event.id, error instanceof Error ? error.name : 'QUEUE_ERROR');
      log.error({ err: error, outboxEventId: event.id }, '[outbox] delivery enqueue failed');
    }
  }

  if (failed > 0) throw new Error(`${failed} outbox event(s) could not be dispatched`);
  await retryFailedNotifications(log);
  log.info({ claimed: events.length }, '[outbox] dispatch batch completed');
}

export const outboxDispatcherWorker = new Worker('outbox-dispatcher', processOutboxDispatchJob, {
  connection: redisQueue,
});

setupWorkerListeners(outboxDispatcherWorker);
