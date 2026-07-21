/**
 * Worker agentic-waiting-list-expire : passe une WaitingListEntry PENDING à
 * EXPIRED quand son expiresAt est dépassé. JobId déterministe pour éviter les
 * doublons de schedule.
 */

import { Worker } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { AuditLogService } from '../core/audit-log.service';
import { TableAllocationService } from '../../floor-plan/table-allocation.service';
import { WaitingListService } from '../core/waiting-list.service';
import { EXPIRE_HOLD_WORKER_CONCURRENCY } from '../../../shared/queue/constants.js';

const audit = new AuditLogService(db);
const tableAllocation = new TableAllocationService(db);
const waitingList = new WaitingListService(db, tableAllocation, audit);

export const agenticWaitingListExpireWorker = new Worker(
  'agentic-waiting-list-expire',
  async (job) => {
    const log = jobLogger(job);
    const { entryId } = job.data as { entryId?: string };
    if (!entryId) {
      log.error('missing entryId in job data');
      return;
    }

    await waitingList.expireEntry(entryId);
    log.info({ entryId }, 'waiting list expiration job');
  },
  {
    connection: redisQueue,
    concurrency: EXPIRE_HOLD_WORKER_CONCURRENCY,
  },
);

setupWorkerListeners(agenticWaitingListExpireWorker);
