import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { queues } from '../queues';
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
  log.info({ claimed: events.length }, '[outbox] dispatch batch completed');
}

export const outboxDispatcherWorker = new Worker('outbox-dispatcher', processOutboxDispatchJob, {
  connection: redisQueue,
});

setupWorkerListeners(outboxDispatcherWorker);
