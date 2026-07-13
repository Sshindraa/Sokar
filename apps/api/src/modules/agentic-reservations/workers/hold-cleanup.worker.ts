/**
 * Worker hold-cleanup : passe en EXPIRED tous les AgenticHold ACTIVE dont
 * expiresAt est dépassé. C'est un filet de sécurité (safety net) en cas de
 * raté du job agentic-expire-hold individuel. Planifié toutes les 5 minutes.
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { HoldService } from '../core/hold.service';
import { AuditLogService } from '../core/audit-log.service';

const audit = new AuditLogService(db);
const defaultHolds = new HoldService(db, audit);

export async function processHoldCleanupJob(
  job: Job,
  holds: HoldService,
): Promise<{ expired: number }> {
  const log = jobLogger(job);
  const expired = await holds.expireOverdue(new Date());
  log.info({ expired }, 'hold cleanup completed');
  return { expired };
}

export const holdCleanupWorker = new Worker(
  'hold-cleanup',
  (job) => processHoldCleanupJob(job, defaultHolds),
  {
    connection: redisQueue,
    concurrency: 1,
  },
);

setupWorkerListeners(holdCleanupWorker);
