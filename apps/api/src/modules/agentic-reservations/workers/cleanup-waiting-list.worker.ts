/**
 * Worker waiting-list-cleanup : filet de sécurité qui passe en EXPIRED toutes
 * les WaitingListEntry PENDING dont l'expiresAt est dépassé. Planifié toutes
 * les 5 minutes.
 */

import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { AuditLogService } from '../core/audit-log.service';
import { TableAllocationService } from '../../floor-plan/table-allocation.service';
import { WaitingListService } from '../core/waiting-list.service';

const audit = new AuditLogService(db);
const tableAllocation = new TableAllocationService(db);
const defaultWaitingList = new WaitingListService(db, tableAllocation, audit);

export async function processWaitingListCleanupJob(
  job: Job,
  waitingList: WaitingListService,
): Promise<{ expired: number }> {
  const log = jobLogger(job);
  const expired = await waitingList.cleanupExpired(new Date());
  log.info({ expired }, 'waiting list cleanup completed');
  return { expired };
}

export const waitingListCleanupWorker = new Worker(
  'waiting-list-cleanup',
  (job) => processWaitingListCleanupJob(job, defaultWaitingList),
  {
    connection: redisQueue,
    concurrency: 1,
  },
);

setupWorkerListeners(waitingListCleanupWorker);
