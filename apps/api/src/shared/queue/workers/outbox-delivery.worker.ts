import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { jobLogger, setupWorkerListeners } from './helper';
import {
  recordPricedUsageEvent,
  type RecordPricedUsageInput,
} from '../../../modules/usage/usage-tariff.service';

export interface OutboxDeliveryJobData {
  readonly outboxEventId: string;
}

/** Consume the currently supported outbox topic. Consumers remain idempotent. */
export async function processOutboxDeliveryJob(job: Job<OutboxDeliveryJobData>): Promise<void> {
  const log = jobLogger(job);
  const event = await db.outboxEvent.findUnique({ where: { id: job.data.outboxEventId } });
  if (!event) {
    log.warn({ outboxEventId: job.data.outboxEventId }, '[outbox] event not found');
    return;
  }

  if (event.topic === 'usage') {
    const payload = event.payload as unknown as RecordPricedUsageInput & {
      occurredAt: string | Date;
    };
    const occurredAt =
      payload.occurredAt instanceof Date ? payload.occurredAt : new Date(payload.occurredAt);
    await recordPricedUsageEvent({ ...payload, occurredAt });
    log.info({ outboxEventId: event.id, topic: event.topic }, '[outbox] event consumed');
    return;
  }

  throw new Error(`Unsupported outbox topic: ${event.topic}`);
}

export const outboxDeliveryWorker = new Worker('outbox-delivery', processOutboxDeliveryJob, {
  connection: redisQueue,
});

setupWorkerListeners(outboxDeliveryWorker);
