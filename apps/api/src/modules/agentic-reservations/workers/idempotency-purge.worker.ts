/**
 * Worker idempotency-purge : supprime les records idempotency expirés
 * dans Postgres. Planifié quotidiennement via upsertJobScheduler dans main.ts.
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { PrismaIdempotencyStore } from '../core/prisma-store';

const store = new PrismaIdempotencyStore(db);

export async function processIdempotencyPurgeJob(job: Job): Promise<{ deleted: number }> {
  const log = jobLogger(job);
  const deleted = await store.purgeExpired();
  log.info({ deleted }, 'idempotency purge completed');
  return { deleted };
}

export const idempotencyPurgeWorker = new Worker('idempotency-purge', processIdempotencyPurgeJob, {
  connection: redisQueue,
  concurrency: 1,
});

setupWorkerListeners(idempotencyPurgeWorker);
