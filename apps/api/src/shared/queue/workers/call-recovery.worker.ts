import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { sendSms } from '../../telnyx/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { queues } from '../queues';

export interface CallRecoveryJobData {
  callId: string;
  restaurantId: string;
  customerPhone: string;
  customerName: string | null;
  restaurantName: string;
  restaurantPhone: string | null;
  reason: 'no_action_with_intent' | 'handoff_dropped' | 'transport_error';
}

/**
 * Sends a single follow-up SMS to a caller whose reservation attempt
 * did not finalize. Idempotent via callId — BullMQ jobId = the same key.
 *
 * Failure handling: 3 retries with exponential backoff; on terminal
 * failure the job is moved to dead-letter via setupWorkerListeners.
 */
export const callRecoveryWorker = new Worker(
  'call-recovery',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as CallRecoveryJobData;

    const opening = data.customerName
      ? `Bonjour ${data.customerName.split(' ')[0]}, `
      : 'Bonjour, ';
    const tail = data.restaurantPhone
      ? ` Appelez le ${data.restaurantPhone} ou rappelez-nous.`
      : ' Rappelez-nous quand vous voulez.';

    const message = `${opening}votre réservation chez ${data.restaurantName} n'a pas pu être confirmée.${tail}`;

    await sendSms(data.customerPhone, message);

    // Best-effort analytics event so the dashboard counter increments
    // even if a downstream reservation is never created.
    try {
      await queues.analytics.add('call-recovery-sent', {
        restaurantId: data.restaurantId,
        callId: data.callId,
        reason: data.reason,
        sentAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn({ err }, 'failed to enqueue recovery analytics event');
    }

    log.info({ callId: data.callId, reason: data.reason }, 'recovery SMS sent');
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(callRecoveryWorker);
