/**
 * Worker agentic-expire-quote : symétrique du expire-hold, mais pour les quotes.
 * Les quotes ne bloquent pas la capacité, mais ils expirent pour ne pas
 * accumuler des réservations fantômes côté UI agent.
 */

import { Worker } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { HoldService } from '../core/hold.service';
import { AuditLogService } from '../core/audit-log.service';

const audit = new AuditLogService(db);
const holds = new HoldService(db, audit);

export const agenticExpireQuoteWorker = new Worker(
  'agentic-expire-quote',
  async (job) => {
    const log = jobLogger(job);
    const { quoteId } = job.data as { quoteId: string };
    if (!quoteId) {
      log.error('missing quoteId in job data');
      return;
    }
    const expired = await holds.expireOne({
      holdId: quoteId,
      expectedType: 'QUOTE',
      actor: 'system:expire-quote-worker',
    });
    log.info({ quoteId, expired }, 'quote expiration job');
  },
  { connection: redisQueue, concurrency: 4 },
);

setupWorkerListeners(agenticExpireQuoteWorker);
