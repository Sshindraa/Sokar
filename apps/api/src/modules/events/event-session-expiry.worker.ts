import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import { expireEventSessions } from './event.service';
import { redisQueue } from '../../shared/redis/client';
import { queues } from '../../shared/queue/queues';
import { logger } from '../../shared/logger/pino';

export interface EventSessionExpiryJob {
  limit?: number;
}

export async function processEventSessionExpiryJob(
  job: Job<EventSessionExpiryJob>,
): Promise<{ closed: number }> {
  const closed = await expireEventSessions({ limit: job.data.limit });
  logger.info({ jobId: job.id, closed }, 'Event sessions expiry completed');
  return { closed };
}

export const eventSessionExpiryWorker = new Worker<EventSessionExpiryJob>(
  queues.eventSessionExpiry.name,
  processEventSessionExpiryJob,
  { connection: redisQueue, concurrency: 1 },
);

eventSessionExpiryWorker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, error }, 'Event session expiry job failed');
});

eventSessionExpiryWorker.on('error', (error) => {
  logger.error({ error }, 'Event session expiry worker error');
});
