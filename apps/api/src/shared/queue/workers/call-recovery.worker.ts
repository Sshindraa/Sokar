import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { sendSms } from '../../telnyx/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { queues } from '../queues';
import { CALL_RECOVERY_WORKER_CONCURRENCY } from '../constants';

export interface CallRecoveryJobData {
  callId: string;
  restaurantId: string;
  customerPhone: string;
  customerName: string | null;
  restaurantName: string;
  restaurantSlug: string | null;
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
export async function processCallRecoveryJob(job: Job): Promise<void> {
  const log = jobLogger(job);
  const data = job.data as CallRecoveryJobData;

  const opening = data.customerName ? `Bonjour ${data.customerName.split(' ')[0]}, ` : 'Bonjour, ';

  // Lien de réservation en ligne (Sokar Connect) si le slug est disponible.
  const siteUrl = process.env.SITE_URL ?? 'https://sokar.tech';
  const bookingUrl =
    data.restaurantSlug != null ? `${siteUrl}/restaurant/${data.restaurantSlug}/book` : null;

  const tail = bookingUrl
    ? ` Réservez en ligne : ${bookingUrl}`
    : data.restaurantPhone
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
}

export const callRecoveryWorker = new Worker('call-recovery', processCallRecoveryJob, {
  connection: redisQueue,
  concurrency: CALL_RECOVERY_WORKER_CONCURRENCY,
});

setupWorkerListeners(callRecoveryWorker);
