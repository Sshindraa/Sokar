import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { redisQueue } from '../../../shared/redis/client';
import { db } from '../../../shared/db/client';
import { sendExpirationReminder } from '../gift-card-email.service';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { queues } from '../../../shared/queue/queues';
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

export interface GiftCardReminderJobData {
  kind: 'scan';
}

export type GiftCardReminderDependencies = {
  db: PrismaClient;
  sendExpirationReminder: typeof sendExpirationReminder;
  claimStore: NotificationClaimStore;
  reconciliationQueue?: NotificationReconciliationQueue;
};

function getDefaultDependencies(): GiftCardReminderDependencies {
  return {
    db,
    sendExpirationReminder,
    claimStore: redisQueue,
    reconciliationQueue: queues.reconciliation,
  };
}

async function requeueUnknownGiftCardReminder(
  queue: NotificationReconciliationQueue | undefined,
  claimKey: string,
  providerMessageId?: string,
): Promise<void> {
  if (!queue) return;
  await enqueueNotificationReconciliation(queue, {
    claimKey,
    provider: 'resend',
    channel: 'email',
    ...(providerMessageId ? { providerMessageId } : {}),
  });
}

export async function processGiftCardReminderJob(
  job: Job<GiftCardReminderJobData>,
  deps: GiftCardReminderDependencies = getDefaultDependencies(),
): Promise<{ sent: number; total: number } | void> {
  const log = jobLogger(job);
  const data = job.data;

  if (data.kind !== 'scan') return;

  const now = new Date();
  const thirtyDaysFromNow = new Date(now);
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const cards = await deps.db.giftCard.findMany({
    where: {
      status: 'ACTIVE',
      expiresAt: { gte: now, lte: thirtyDaysFromNow },
      reminderSentAt: null,
      recipientEmail: { not: null },
    },
    include: { restaurant: { select: { name: true, id: true } } },
  });

  log.info({ count: cards.length }, 'gift-card-reminder scan: cards to remind');

  let sent = 0;
  for (const card of cards) {
    const latest = await deps.db.giftCard.findUnique({
      where: { id: card.id },
      select: { status: true, reminderSentAt: true },
    });
    if (!latest || latest.status !== 'ACTIVE' || latest.reminderSentAt !== null) {
      log.info({ giftCardId: card.id }, 'gift card reminder skipped: card no longer eligible');
      continue;
    }

    const claimKey = buildNotificationClaimKey('gift-card-expiration-reminder', card.id);
    const claim = await acquireNotificationClaim(deps.claimStore, claimKey, {
      provider: 'resend',
      channel: 'email',
    });
    if (!claim.acquired || !claim.token) {
      if (claim.record?.status === 'unknown') {
        try {
          await requeueUnknownGiftCardReminder(
            deps.reconciliationQueue,
            claimKey,
            claim.record.providerMessageId,
          );
        } catch (err) {
          log.error(
            { err: err instanceof Error ? err.message : String(err), outcome: 'unknown' },
            'failed to requeue unknown gift card reminder',
          );
        }
      }
      log.info({ giftCardId: card.id }, 'gift card reminder skipped: duplicate claim');
      continue;
    }

    try {
      const result = normalizeNotificationSendResult(
        await deps.sendExpirationReminder({
          giftCardId: card.id,
          code: card.code,
          shortCode: card.shortCode,
          amount: card.amount.toNumber(),
          remainingAmount: card.remainingAmount.toNumber(),
          restaurantName: card.restaurant.name,
          recipientName: card.recipientName,
          recipientEmail: card.recipientEmail!,
          expiresAt: card.expiresAt!,
        }),
        'resend',
        'email',
      );
      recordNotificationProviderResult('resend', 'email', result.outcome);
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
        log.warn({ giftCardId: card.id, outcome: result.outcome }, 'gift card reminder refused');
        throw new NotificationProviderRefusedError(result.provider, result.channel);
      }
      if (result.outcome === 'unknown') {
        if (transitioned) {
          try {
            await requeueUnknownGiftCardReminder(
              deps.reconciliationQueue,
              claimKey,
              result.providerMessageId,
            );
          } catch (reconciliationError) {
            log.error(
              {
                err:
                  reconciliationError instanceof Error
                    ? reconciliationError.message
                    : String(reconciliationError),
                outcome: 'unknown',
              },
              'failed to queue gift card reminder reconciliation',
            );
          }
        }
        log.warn({ giftCardId: card.id, outcome: result.outcome }, 'gift card reminder unknown');
        continue;
      }

      await deps.db.giftCard.update({
        where: { id: card.id },
        data: { reminderSentAt: new Date() },
      });
      sent++;
    } catch (err) {
      if (err instanceof NotificationProviderRefusedError) throw err;
      const outcome: NotificationProviderResult = classifyNotificationError(err);
      recordNotificationProviderResult('resend', 'email', outcome);
      const transitioned = await recordNotificationResult(
        deps.claimStore,
        claimKey,
        claim.token,
        outcome,
        { provider: 'resend', channel: 'email' },
      );
      if (outcome === 'unknown' && transitioned) {
        try {
          await requeueUnknownGiftCardReminder(deps.reconciliationQueue, claimKey);
        } catch (reconciliationError) {
          log.error(
            {
              err:
                reconciliationError instanceof Error
                  ? reconciliationError.message
                  : String(reconciliationError),
              outcome: 'unknown',
            },
            'failed to queue gift card reminder reconciliation',
          );
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      if (outcome === 'unknown') {
        log.warn({ outcome }, 'gift card reminder provider result unknown');
      } else {
        log.error({ err: message, outcome }, 'failed to send gift card reminder');
        // A certain refusal is safe to retry through the same deterministic
        // BullMQ job; an unknown result must remain claim-protected.
        throw err;
      }
    }
  }

  log.info({ sent, total: cards.length }, 'gift-card-reminder scan complete');
  return { sent, total: cards.length };
}

export const giftCardReminderWorker = new Worker(
  'gift-card-reminder',
  (job) => processGiftCardReminderJob(job as Job<GiftCardReminderJobData>),
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(giftCardReminderWorker);
