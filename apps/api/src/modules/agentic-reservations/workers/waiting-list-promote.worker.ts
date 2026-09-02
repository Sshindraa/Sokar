import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { queues } from '../../../shared/queue/queues';
import { sendSms } from '../../../shared/telnyx/client';
import { sendEmail } from '../../../shared/email';
import { formatDate } from '@sokar/shared';
import {
  buildWaitingListPromotionSms,
  buildWaitingListPromotionEmailHtml,
} from '../emails/waiting-list-promotion.js';
import {
  acquireNotificationClaim,
  buildNotificationClaimKey,
  classifyNotificationError,
  enqueueNotificationReconciliation,
  normalizeNotificationSendResult,
  NotificationProviderRefusedError,
  recordNotificationResult,
  type NotificationClaimStore,
  type NotificationProviderResult,
  type NotificationReconciliationQueue,
} from '../../../shared/queue/notification-idempotency';
import { recordNotificationProviderResult } from '../../../shared/observability/metrics';

export interface WaitingListPromoteJobData {
  entryId: string;
  reservationId: string;
  channel: 'sms' | 'email';
}

export type WaitingListPromoteDependencies = {
  db: PrismaClient;
  sendSms: typeof sendSms;
  sendEmail: typeof sendEmail;
  formatDate: typeof formatDate;
  claimStore?: NotificationClaimStore;
  reconciliationQueue?: NotificationReconciliationQueue;
};

async function requeueUnknownPromotion(
  queue: NotificationReconciliationQueue | undefined,
  claimKey: string,
  channel: 'sms' | 'email',
  providerMessageId?: string,
): Promise<void> {
  if (!queue) return;
  await enqueueNotificationReconciliation(queue, {
    claimKey,
    provider: channel === 'email' ? 'resend' : 'telnyx',
    channel,
    ...(providerMessageId ? { providerMessageId } : {}),
  });
}

export async function processWaitingListPromoteJob(
  job: Job<WaitingListPromoteJobData>,
  deps: WaitingListPromoteDependencies = {
    db,
    sendSms,
    sendEmail,
    formatDate,
    claimStore: redisQueue,
    reconciliationQueue: queues.reconciliation,
  },
): Promise<void> {
  const log = jobLogger(job);
  const claimStore = deps.claimStore ?? redisQueue;
  const { entryId, reservationId, channel } = job.data;

  const entry = await deps.db.waitingListEntry.findUnique({
    where: { id: entryId },
    include: { restaurant: true, promotedReservation: true },
  });

  if (!entry) {
    log.warn({ entryId }, 'waiting list entry not found, skipping');
    return;
  }
  if (entry.status !== 'PROMOTED') {
    log.warn({ entryId }, 'waiting list entry not PROMOTED, skipping');
    return;
  }
  if (entry.promotedReservationId !== reservationId || !entry.promotedReservation) {
    log.warn({ entryId, reservationId }, 'promoted reservation mismatch, skipping');
    return;
  }
  const promotedReservation = entry.promotedReservation as {
    status?: string;
    state?: string;
  };
  if (
    (promotedReservation.status !== undefined && promotedReservation.status !== 'CONFIRMED') ||
    promotedReservation.state !== 'CONFIRMED'
  ) {
    log.info(
      { entryId, reservationId },
      'promotion notification skipped: reservation not confirmed',
    );
    return;
  }
  if (!entry.restaurant) {
    log.warn({ entryId }, 'restaurant not found, skipping');
    return;
  }

  const date = deps.formatDate(entry.slotStart, 'fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const time = deps.formatDate(entry.slotStart, 'fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const restaurantPhone = (entry.restaurant.phoneNumber || entry.restaurant.phoneE164 || '').trim();
  if (!restaurantPhone) {
    log.warn({ entryId }, 'restaurant phone missing, skipping promotion notification');
    return;
  }
  const templateData = {
    restaurantName: entry.restaurant.name,
    date,
    time,
    partySize: entry.partySize,
    restaurantPhone,
  };

  if (channel === 'sms') {
    if (!entry.customerPhone) {
      log.warn({ entryId }, 'no customer phone for SMS, skipping');
      return;
    }
    const claimKey = buildNotificationClaimKey('waiting-list-promotion-sms', entryId);
    const claim = await acquireNotificationClaim(claimStore, claimKey, {
      provider: 'telnyx',
      channel: 'sms',
    });
    if (!claim.acquired || !claim.token) {
      if (claim.record?.status === 'unknown') {
        try {
          await requeueUnknownPromotion(
            deps.reconciliationQueue,
            claimKey,
            'sms',
            claim.record.providerMessageId,
          );
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
            'failed to requeue waiting list SMS reconciliation',
          );
        }
      }
      log.info({ entryId, reservationId, channel }, 'waiting list SMS skipped: duplicate claim');
      return;
    }
    try {
      const result = normalizeNotificationSendResult(
        await deps.sendSms(entry.customerPhone, buildWaitingListPromotionSms(templateData)),
        'telnyx',
        'sms',
      );
      recordNotificationProviderResult('telnyx', 'sms', result.outcome);
      const transitioned = await recordNotificationResult(
        claimStore,
        claimKey,
        claim.token,
        result.outcome,
        {
          provider: result.provider,
          channel: result.channel,
          ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        },
      );
      if (result.outcome === 'unknown') {
        if (transitioned) {
          try {
            await requeueUnknownPromotion(
              deps.reconciliationQueue,
              claimKey,
              'sms',
              result.providerMessageId,
            );
          } catch (err) {
            log.error(
              { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
              'failed to queue waiting list SMS reconciliation',
            );
          }
        }
        log.warn({ entryId, reservationId, outcome: 'unknown' }, 'waiting list SMS result unknown');
        return;
      }
      if (result.outcome === 'failure_certain') {
        log.warn(
          { entryId, reservationId, outcome: result.outcome },
          'waiting list SMS provider refused the message',
        );
        throw new NotificationProviderRefusedError(result.provider, result.channel);
      }
      log.info({ entryId, reservationId, channel }, 'waiting list promotion SMS sent');
    } catch (err) {
      if (err instanceof NotificationProviderRefusedError) throw err;
      const outcome: NotificationProviderResult = classifyNotificationError(err);
      recordNotificationProviderResult('telnyx', 'sms', outcome);
      const transitioned = await recordNotificationResult(
        claimStore,
        claimKey,
        claim.token,
        outcome,
        { provider: 'telnyx', channel: 'sms' },
      );
      if (outcome === 'unknown') {
        if (transitioned) {
          try {
            await requeueUnknownPromotion(deps.reconciliationQueue, claimKey, 'sms');
          } catch (reconciliationError) {
            log.error(
              {
                err:
                  reconciliationError instanceof Error
                    ? reconciliationError.message
                    : String(reconciliationError),
                outcome: 'unknown',
              },
              'failed to queue waiting list SMS reconciliation',
            );
          }
        }
        log.warn({ entryId, reservationId, outcome }, 'waiting list SMS result unknown');
        return;
      }
      throw err;
    }
  } else if (channel === 'email') {
    if (!entry.customerEmail) {
      log.warn({ entryId }, 'no customer email, skipping');
      return;
    }
    if (!process.env.RESEND_API_KEY) {
      log.warn({ entryId }, 'RESEND_API_KEY not configured, skipping email');
      return;
    }
    const claimKey = buildNotificationClaimKey('waiting-list-promotion-email', entryId);
    const claim = await acquireNotificationClaim(claimStore, claimKey, {
      provider: 'resend',
      channel: 'email',
    });
    if (!claim.acquired || !claim.token) {
      if (claim.record?.status === 'unknown') {
        try {
          await requeueUnknownPromotion(
            deps.reconciliationQueue,
            claimKey,
            'email',
            claim.record.providerMessageId,
          );
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
            'failed to requeue waiting list email reconciliation',
          );
        }
      }
      log.info({ entryId, reservationId, channel }, 'waiting list email skipped: duplicate claim');
      return;
    }
    try {
      const result = normalizeNotificationSendResult(
        await deps.sendEmail({
          to: entry.customerEmail,
          subject: `Votre table chez ${entry.restaurant.name} est confirmée`,
          html: buildWaitingListPromotionEmailHtml(templateData),
        }),
        'resend',
        'email',
      );
      recordNotificationProviderResult('resend', 'email', result.outcome);
      const transitioned = await recordNotificationResult(
        claimStore,
        claimKey,
        claim.token,
        result.outcome,
        {
          provider: result.provider,
          channel: result.channel,
          ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
        },
      );
      if (result.outcome === 'unknown') {
        if (transitioned) {
          try {
            await requeueUnknownPromotion(
              deps.reconciliationQueue,
              claimKey,
              'email',
              result.providerMessageId,
            );
          } catch (err) {
            log.error(
              { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
              'failed to queue waiting list email reconciliation',
            );
          }
        }
        log.warn(
          { entryId, reservationId, outcome: 'unknown' },
          'waiting list email result unknown',
        );
        return;
      }
      if (result.outcome === 'failure_certain') {
        log.warn(
          { entryId, reservationId, outcome: result.outcome },
          'waiting list email provider refused the message',
        );
        throw new NotificationProviderRefusedError(result.provider, result.channel);
      }
      log.info({ entryId, reservationId, channel }, 'waiting list promotion email sent');
    } catch (err) {
      if (err instanceof NotificationProviderRefusedError) throw err;
      const outcome: NotificationProviderResult = classifyNotificationError(err);
      recordNotificationProviderResult('resend', 'email', outcome);
      const transitioned = await recordNotificationResult(
        claimStore,
        claimKey,
        claim.token,
        outcome,
        { provider: 'resend', channel: 'email' },
      );
      if (outcome === 'unknown') {
        if (transitioned) {
          try {
            await requeueUnknownPromotion(deps.reconciliationQueue, claimKey, 'email');
          } catch (reconciliationError) {
            log.error(
              {
                err:
                  reconciliationError instanceof Error
                    ? reconciliationError.message
                    : String(reconciliationError),
                outcome: 'unknown',
              },
              'failed to queue waiting list email reconciliation',
            );
          }
        }
        log.warn({ entryId, reservationId, outcome }, 'waiting list email result unknown');
        return;
      }
      throw err;
    }
  }
}

export const waitingListPromoteWorker = new Worker(
  'waiting-list-promote',
  async (job) => processWaitingListPromoteJob(job),
  {
    connection: redisQueue,
    concurrency: 4,
  },
);

setupWorkerListeners(waitingListPromoteWorker);
