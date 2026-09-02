import { Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@prisma/client';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendReminder } from '../../messaging/sender';
import { setupWorkerListeners, jobLogger } from './helper';
import { formatDate } from '@sokar/shared';
import { queues } from '../queues';
import { CONFIRMATION_SMS_WORKER_CONCURRENCY } from '../constants';
import {
  acquireNotificationClaim,
  buildNotificationClaimKey,
  classifyNotificationError,
  enqueueNotificationReconciliation,
  NotificationProviderRefusedError,
  recordNotificationResult,
  type NotificationClaimStore,
  type NotificationProviderResult,
  type NotificationReconciliationQueue,
} from '../notification-idempotency';

/**
 * Worker pour l'envoi des rappels de réservation J-1.
 *
 * Canal : WhatsApp (utility template) si configuré, sinon SMS.
 * Le fallback WhatsApp→SMS est autorisé uniquement après un refus certain —
 * voir shared/messaging/sender.ts. Un résultat unknown reste bloqué.
 *
 * Jobs :
 * 1. { kind: 'scan' } — Scanne les réservations de demain et envoie un rappel.
 * 2. { kind: 'send', reservationId } — Envoie un rappel pour une résa spécifique.
 */

export interface ConfirmationSmsJobData {
  kind: 'scan' | 'send';
  reservationId?: string;
}

export type ConfirmationSmsDependencies = {
  db: PrismaClient;
  sendReminder: typeof sendReminder;
  formatDate: typeof formatDate;
  claimStore: NotificationClaimStore;
  reconciliationQueue?: NotificationReconciliationQueue;
  /** Compatibility mode for injected legacy fakes; production uses sender claims. */
  manageReminderClaims?: boolean;
};

function getDefaultDependencies(): ConfirmationSmsDependencies {
  return {
    db,
    sendReminder,
    formatDate,
    claimStore: redisQueue,
    reconciliationQueue: queues.reconciliation,
    manageReminderClaims: true,
  };
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isReminderEligible(reservation: {
  status: string;
  state: string;
  confirmationSentAt: Date | null;
}): boolean {
  // La confirmation client ne peut être envoyée qu'après la confirmation
  // métier. status reste une projection legacy et ne suffit pas à lui seul.
  return (
    reservation.status === 'CONFIRMED' &&
    reservation.state === 'CONFIRMED' &&
    reservation.confirmationSentAt === null
  );
}

function getResultOutcome(
  result: Awaited<ReturnType<typeof sendReminder>>,
): NotificationProviderResult {
  return result.outcome ?? (result.success ? 'success' : 'failure_certain');
}

async function requeueUnknownClaim(
  reconciliationQueue: NotificationReconciliationQueue | undefined,
  claimKey: string,
  record: {
    provider?: 'telnyx' | 'resend';
    channel?: 'sms' | 'whatsapp' | 'email';
    providerMessageId?: string;
  },
): Promise<void> {
  if (!reconciliationQueue || !record.provider || !record.channel) return;
  try {
    await enqueueNotificationReconciliation(reconciliationQueue, {
      claimKey,
      provider: record.provider,
      channel: record.channel,
      ...(record.providerMessageId ? { providerMessageId: record.providerMessageId } : {}),
    });
  } catch (err) {
    // The claim remains unknown. A future job can retry queue insertion without
    // touching the provider again.
    throw err;
  }
}

async function recordWorkerResult(
  deps: ConfirmationSmsDependencies,
  claimKey: string,
  token: string,
  result: Awaited<ReturnType<typeof sendReminder>>,
): Promise<void> {
  const outcome = getResultOutcome(result);
  const transitioned = await recordNotificationResult(deps.claimStore, claimKey, token, outcome, {
    provider: result.provider ?? 'telnyx',
    channel: result.channel,
    ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
  });
  if (outcome === 'unknown' && transitioned) {
    await requeueUnknownClaim(deps.reconciliationQueue, claimKey, {
      provider: result.provider ?? 'telnyx',
      channel: result.channel,
      ...(result.providerMessageId ? { providerMessageId: result.providerMessageId } : {}),
    });
  }
}

async function processReminderForReservation(
  deps: ConfirmationSmsDependencies,
  log: ReturnType<typeof jobLogger>,
  r: {
    id: string;
    customerPhone: string | null;
    restaurantId: string;
    customerId: string | null;
    restaurant: { name: string; id: string };
    reservedAt: Date;
    partySize: number;
  },
): Promise<Awaited<ReturnType<typeof sendReminder>>> {
  if (!r.customerPhone) {
    return { channel: 'sms', success: false, outcome: 'failure_certain', provider: 'telnyx' };
  }
  const reminderParams = {
    to: r.customerPhone,
    restaurantName: r.restaurant.name,
    restaurantId: r.restaurantId,
    reservationId: r.id,
    customerId: r.customerId ?? undefined,
    date: deps.formatDate(r.reservedAt, 'fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }),
    time: formatTime(r.reservedAt),
    partySize: r.partySize,
  };

  if (deps.manageReminderClaims) {
    return deps.sendReminder(reminderParams, {
      claimStore: deps.claimStore,
      reconciliationQueue: deps.reconciliationQueue,
    });
  }

  const claimKey = buildNotificationClaimKey('reservation-reminder', r.id);
  const attempt = await acquireNotificationClaim(deps.claimStore, claimKey, {
    provider: 'telnyx',
    channel: 'sms',
  });
  if (!attempt.acquired || !attempt.token) {
    if (attempt.record?.status === 'unknown') {
      try {
        await requeueUnknownClaim(deps.reconciliationQueue, claimKey, attempt.record);
      } catch (err) {
        log.error(
          { err: err instanceof Error ? err.message : String(err) },
          'failed to requeue unknown reminder',
        );
      }
    }
    log.info({ reservationId: r.id }, 'reminder skipped: claim is already owned');
    return { channel: 'sms', success: false, outcome: 'unknown', provider: 'telnyx' };
  }

  try {
    const result = await deps.sendReminder(reminderParams);
    await recordWorkerResult(deps, claimKey, attempt.token, result);
    return result;
  } catch (err) {
    const outcome = classifyNotificationError(err);
    const result = {
      channel: 'sms' as const,
      success: false,
      outcome,
      provider: 'telnyx' as const,
      error: err instanceof Error ? err.message : String(err),
    };
    await recordWorkerResult(deps, claimKey, attempt.token, result);
    if (outcome === 'failure_certain') throw err;
    log.error({ outcome }, 'reminder provider result unknown');
    return result;
  }
}

export async function processConfirmationSmsJob(
  job: Job<ConfirmationSmsJobData>,
  deps: ConfirmationSmsDependencies = getDefaultDependencies(),
): Promise<{
  sent: number;
  whatsappCount: number;
  smsCount: number;
  total: number;
} | void> {
  const log = jobLogger(job);
  const data = job.data;

  if (data.kind === 'scan') {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    const reservations = await deps.db.reservation.findMany({
      where: {
        status: 'CONFIRMED',
        reservedAt: { gte: tomorrow, lt: dayAfter },
        customerPhone: { not: null },
        confirmationStatus: { in: ['NOT_REQUIRED', 'PENDING'] },
        confirmationSentAt: null,
      },
      include: { restaurant: { select: { name: true, id: true } } },
    });

    log.info({ count: reservations.length }, 'rappel scan: reservations to remind');

    let sent = 0;
    let whatsappCount = 0;
    let smsCount = 0;
    for (const r of reservations) {
      if (!r.customerPhone) continue;

      const latest = await deps.db.reservation.findUnique({
        where: { id: r.id },
        select: { status: true, state: true, confirmationSentAt: true },
      });
      if (!latest || !isReminderEligible(latest)) {
        log.info({ reservationId: r.id }, 'reminder skipped: reservation no longer eligible');
        continue;
      }

      try {
        const result = await processReminderForReservation(deps, log, r);
        if (getResultOutcome(result) === 'success') {
          await deps.db.reservation.update({
            where: { id: r.id },
            data: {
              confirmationStatus: 'PENDING',
              confirmationSentAt: new Date(),
            },
          });
          sent++;
          if (result.channel === 'whatsapp') whatsappCount++;
          else smsCount++;
        } else if (getResultOutcome(result) === 'failure_certain') {
          log.warn(
            { reservationId: r.id, channel: result.channel, outcome: result.outcome },
            'reminder send refused — BullMQ will retry the deterministic job',
          );
          throw new NotificationProviderRefusedError(result.provider ?? 'telnyx', result.channel);
        } else {
          log.warn(
            { reservationId: r.id, channel: result.channel, outcome: result.outcome },
            'reminder send result unknown, status not updated',
          );
        }
      } catch (err) {
        if (err instanceof NotificationProviderRefusedError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err: message, reservationId: r.id }, 'failed to send reminder');
      }
    }

    log.info({ sent, whatsappCount, smsCount, total: reservations.length }, 'rappel scan complete');
    return { sent, whatsappCount, smsCount, total: reservations.length };
  }

  if (data.kind === 'send' && data.reservationId) {
    const r = await deps.db.reservation.findUniqueOrThrow({
      where: { id: data.reservationId },
      include: { restaurant: { select: { name: true, id: true } } },
    });
    if (!r.customerPhone) {
      log.warn({ reservationId: r.id }, 'no customer phone, skipping');
      return;
    }
    if (!isReminderEligible(r)) {
      log.info({ reservationId: r.id }, 'reminder skipped: reservation no longer eligible');
      return;
    }

    try {
      const result = await processReminderForReservation(deps, log, r);
      if (getResultOutcome(result) === 'success') {
        await deps.db.reservation.update({
          where: { id: r.id },
          data: {
            confirmationStatus: 'PENDING',
            confirmationSentAt: new Date(),
          },
        });
        log.info({ reservationId: r.id, channel: result.channel }, 'reminder sent');
      } else if (getResultOutcome(result) === 'failure_certain') {
        log.warn(
          { reservationId: r.id, channel: result.channel, outcome: result.outcome },
          'reminder send refused — BullMQ will retry the deterministic job',
        );
        throw new NotificationProviderRefusedError(result.provider ?? 'telnyx', result.channel);
      } else {
        log.warn(
          { reservationId: r.id, channel: result.channel, outcome: result.outcome },
          'reminder send result unknown, status not updated',
        );
      }
    } catch (err) {
      throw err;
    }
  }
}

export const confirmationSmsWorker = new Worker(
  'confirmation-sms',
  (job) => processConfirmationSmsJob(job as Job<ConfirmationSmsJobData>),
  { connection: redisQueue, concurrency: CONFIRMATION_SMS_WORKER_CONCURRENCY },
);

setupWorkerListeners(confirmationSmsWorker);
