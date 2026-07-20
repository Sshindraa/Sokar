import { Worker, type Job } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';
import { db } from '../../../shared/db/client';
import { sendSms } from '../../../shared/telnyx/client';
import { sendEmail } from '../../../shared/email';
import { formatDate } from '@sokar/shared';
import {
  buildWaitingListPromotionSms,
  buildWaitingListPromotionEmailHtml,
} from '../emails/waiting-list-promotion.js';

export interface WaitingListPromoteJobData {
  entryId: string;
  reservationId: string;
  channel: 'sms' | 'email';
}

export async function processWaitingListPromoteJob(
  job: Job<WaitingListPromoteJobData>,
  deps = { db, sendSms, sendEmail, formatDate },
): Promise<void> {
  const log = jobLogger(job);
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
    await deps.sendSms(entry.customerPhone, buildWaitingListPromotionSms(templateData));
    log.info({ entryId, reservationId, channel }, 'waiting list promotion SMS sent');
  } else if (channel === 'email') {
    if (!entry.customerEmail) {
      log.warn({ entryId }, 'no customer email, skipping');
      return;
    }
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
      log.warn({ entryId }, 'SMTP not configured, skipping email');
      return;
    }
    await deps.sendEmail({
      to: entry.customerEmail,
      subject: `Votre table chez ${entry.restaurant.name} est confirmée`,
      html: buildWaitingListPromotionEmailHtml(templateData),
    });
    log.info({ entryId, reservationId, channel }, 'waiting list promotion email sent');
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
