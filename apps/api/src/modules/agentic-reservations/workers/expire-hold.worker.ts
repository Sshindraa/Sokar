/**
 * Worker agentic-expire-hold : passe les AgenticHold à EXPIRED quand
 * leur expiresAt est dépassé. Le jobId déterministe garantit qu'on ne
 * programme pas deux fois le même hold.
 */

import { Worker } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { HoldService } from '../core/hold.service';
import { AuditLogService } from '../core/audit-log.service';

const audit = new AuditLogService(db);
const holds = new HoldService(db, audit);

export const agenticExpireHoldWorker = new Worker(
  'agentic-expire-hold',
  async (job) => {
    const log = jobLogger(job);
    const { holdId } = job.data as { holdId: string };
    if (!holdId) {
      log.error('missing holdId in job data');
      return;
    }
    const expired = await holds.expireOne({
      holdId,
      expectedType: 'HOLD',
      actor: 'system:expire-hold-worker',
    });
    log.info({ holdId, expired }, 'hold expiration job');
  },
  { connection: redisQueue, concurrency: 4 },
);

setupWorkerListeners(agenticExpireHoldWorker);
