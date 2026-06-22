/**
 * Worker agentic-notify : envoie les notifications de confirmation/
 * annulation aux clients agentic (ChatGPT widget, MCP tool responses,
 * SMS transactionnel, email).
 *
 * MVP P1 : log structured + appel Sentry breadcrumb. L'intégration SMS
 * et email viendra avec la Phase 5 (RGPD + sous-traitants).
 */

import { Worker } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { logger } from '../../../shared/logger/pino';

interface AgenticNotifyJobData {
  reservationId: string;
  channel: 'sms' | 'email' | 'mcp' | 'openai';
  reason: 'created' | 'updated' | 'cancelled';
}

export const agenticNotifyWorker = new Worker(
  'agentic-notify',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as AgenticNotifyJobData;
    if (!data.reservationId) {
      log.error('missing reservationId in job data');
      return;
    }

    const reservation = await db.reservation.findUnique({
      where: { id: data.reservationId },
      select: { id: true, state: true, partySize: true, customerPhone: true },
    });

    if (!reservation) {
      log.warn({ reservationId: data.reservationId }, 'reservation not found, skipping notify');
      return;
    }

    // MVP : log structuré (pino) — Sentry breadcrumb à ajouter quand
    // Sentry.captureAgenticEvent() sera défini.
    logger.info(
      {
        reservationId: reservation.id,
        channel: data.channel,
        reason: data.reason,
        state: reservation.state,
        partySize: reservation.partySize,
      },
      'agentic reservation notification dispatched',
    );
  },
  { connection: redisQueue, concurrency: 8 },
);

setupWorkerListeners(agenticNotifyWorker);
