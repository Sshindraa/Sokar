import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { redisQueue } from '../../redis/client';
import { sendSms } from '../../telnyx/client';
import { db } from '../../db/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { CONFIRMATION_SMS_SENT_EVENT } from '../../observability/system-checks';
import { queues } from '../queues';
import {
  acquireNotificationClaim,
  buildNotificationClaimKey,
  classifyNotificationError,
  enqueueNotificationReconciliation,
  normalizeNotificationSendResult,
  NotificationProviderRefusedError,
  recordNotificationResult,
  type NotificationProviderResult,
  type NotificationReconciliationQueue,
  type NotificationClaimStore,
} from '../notification-idempotency';
import { recordNotificationProviderResult } from '../../observability/metrics';

export interface OutboundConfirmJobData {
  reservationId: string;
  customerPhone: string;
  customerName: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
}

export type OutboundConfirmDependencies = {
  db: PrismaClient;
  sendSms: typeof sendSms;
  claimStore: NotificationClaimStore;
  reconciliationQueue?: NotificationReconciliationQueue;
};

function getDefaultDependencies(): OutboundConfirmDependencies {
  return {
    db,
    sendSms,
    claimStore: redisQueue,
    reconciliationQueue: queues.reconciliation,
  };
}

async function requeueUnknownConfirmation(
  deps: OutboundConfirmDependencies,
  claimKey: string,
  providerMessageId?: string,
): Promise<void> {
  if (!deps.reconciliationQueue) return;
  await enqueueNotificationReconciliation(deps.reconciliationQueue, {
    claimKey,
    provider: 'telnyx',
    channel: 'sms',
    ...(providerMessageId ? { providerMessageId } : {}),
  });
}

export async function processOutboundConfirmJob(
  job: Job<OutboundConfirmJobData>,
  deps: OutboundConfirmDependencies = getDefaultDependencies(),
): Promise<void> {
  const log = jobLogger(job);
  const data = job.data;
  const reservation = await deps.db.reservation.findUnique({
    where: { id: data.reservationId },
    select: { id: true, status: true, state: true },
  });

  // Une réservation non confirmée ou terminale ne doit pas déclencher un SMS
  // de confirmation resté en file. Le claim doit rester disponible pour une
  // future confirmation explicite.
  if (!reservation || reservation.status !== 'CONFIRMED' || reservation.state !== 'CONFIRMED') {
    log.info(
      { reservationId: data.reservationId },
      'confirmation SMS skipped: reservation not confirmed',
    );
    return;
  }

  const alreadyAudited = await deps.db.reservationAuditLog.findFirst({
    where: { reservationId: data.reservationId, event: CONFIRMATION_SMS_SENT_EVENT },
    select: { id: true },
  });
  if (alreadyAudited) {
    log.info({ reservationId: data.reservationId }, 'confirmation SMS skipped: already audited');
    return;
  }

  const claimKey = buildNotificationClaimKey('reservation-confirmation-sms', data.reservationId);
  const claim = await acquireNotificationClaim(deps.claimStore, claimKey, {
    provider: 'telnyx',
    channel: 'sms',
  });
  if (!claim.acquired || !claim.token) {
    if (claim.record?.status === 'unknown') {
      try {
        await requeueUnknownConfirmation(deps, claimKey, claim.record.providerMessageId);
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
          'failed to requeue unknown confirmation',
        );
      }
    }
    log.info({ reservationId: data.reservationId }, 'confirmation SMS skipped: duplicate claim');
    return;
  }

  try {
    const message = `Reservation confirmee - ${data.restaurantName} ${data.date} ${data.time} ${data.partySize}pers. Annulation: appelez le restaurant.`;
    const result = normalizeNotificationSendResult(
      await deps.sendSms(data.customerPhone, message),
      'telnyx',
      'sms',
    );
    recordNotificationProviderResult('telnyx', 'sms', result.outcome);
    const transitioned = await recordNotificationResult(
      deps.claimStore,
      claimKey,
      claim.token,
      result.outcome,
      {
        provider: result.provider,
        channel: result.channel,
        ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
      },
    );
    if (result.outcome === 'failure_certain') {
      log.warn({ outcome: result.outcome }, 'confirmation provider refused the message');
      throw new NotificationProviderRefusedError(result.provider, result.channel);
    }
    if (result.outcome === 'unknown') {
      if (transitioned) {
        try {
          await requeueUnknownConfirmation(deps, claimKey, result.providerMessageId);
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
            'failed to queue confirmation reconciliation',
          );
        }
      }
      log.warn({ outcome: result.outcome }, 'confirmation provider result unknown');
      return;
    }

    // Trace append-only de l'envoi réussi : le check « réservation sans SMS »
    // du worker system-health s'appuie sur cet audit (aucune table SmsLog).
    try {
      await deps.db.reservationAuditLog.create({
        data: {
          reservationId: data.reservationId,
          actor: 'system',
          event: CONFIRMATION_SMS_SENT_EVENT,
          metadata: { channel: 'sms' },
        },
      });
    } catch (err) {
      log.warn({ err, reservationId: data.reservationId }, 'confirmation SMS audit write failed');
    }
    log.info({ reservationId: data.reservationId }, 'outbound confirmation sent');
  } catch (err) {
    if (err instanceof NotificationProviderRefusedError) throw err;
    const outcome: NotificationProviderResult = classifyNotificationError(err);
    recordNotificationProviderResult('telnyx', 'sms', outcome);
    const providerMessageId =
      err &&
      typeof err === 'object' &&
      'providerMessageId' in err &&
      typeof (err as { providerMessageId?: unknown }).providerMessageId === 'string'
        ? (err as { providerMessageId: string }).providerMessageId
        : undefined;
    const transitioned = await recordNotificationResult(
      deps.claimStore,
      claimKey,
      claim.token,
      outcome,
      {
        provider: 'telnyx',
        channel: 'sms',
        ...(providerMessageId ? { providerMessageId } : {}),
      },
    );
    if (outcome === 'unknown') {
      if (transitioned) {
        try {
          await requeueUnknownConfirmation(deps, claimKey, providerMessageId);
        } catch (reconciliationError) {
          log.error(
            {
              err:
                reconciliationError instanceof Error
                  ? reconciliationError.message
                  : String(reconciliationError),
              outcome: 'unknown',
            },
            'failed to queue confirmation reconciliation',
          );
        }
      }
      log.warn({ outcome }, 'confirmation provider result unknown');
      return;
    }
    // Only a certain provider refusal is propagated to BullMQ for retry.
    throw err;
  }
}

export const outboundConfirmWorker = new Worker(
  'sms-client',
  (job) => processOutboundConfirmJob(job as Job<OutboundConfirmJobData>),
  {
    connection: redisQueue,
    concurrency: 5,
  },
);

setupWorkerListeners(outboundConfirmWorker);
