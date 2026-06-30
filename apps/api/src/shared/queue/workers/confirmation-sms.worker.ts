import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendSms } from '../../telnyx/client';
import { setupWorkerListeners, jobLogger } from './helper';

/**
 * Worker pour l'envoi des SMS de rappel J-1.
 *
 * Le SMS est un rappel simple — aucun call to action.
 * Le client n'a rien à faire, c'est juste un courtesy reminder qui réduit les no-shows.
 *
 * Jobs :
 * 1. { kind: 'scan' } — Scanne les réservations de demain et envoie un rappel SMS.
 * 2. { kind: 'send', reservationId } — Envoie un rappel pour une résa spécifique.
 */

interface ConfirmationSmsJobData {
  kind: 'scan' | 'send';
  reservationId?: string;
}

function formatReminderSms(restaurantName: string, date: Date, partySize: number): string {
  const dateStr = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeStr = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `Rappel ${restaurantName}: votre réservation ${dateStr} à ${timeStr} pour ${partySize} pers. Nous avons hâte de vous accueillir.`;
}

export const confirmationSmsWorker = new Worker(
  'confirmation-sms',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as ConfirmationSmsJobData;

    if (data.kind === 'scan') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);

      const reservations = await db.reservation.findMany({
        where: {
          status: 'CONFIRMED',
          reservedAt: { gte: tomorrow, lt: dayAfter },
          customerPhone: { not: null },
          confirmationStatus: { in: ['NOT_REQUIRED', 'PENDING'] },
        },
        include: { restaurant: { select: { name: true, id: true } } },
      });

      log.info({ count: reservations.length }, 'rappel scan: reservations to remind');

      let sent = 0;
      for (const r of reservations) {
        if (!r.customerPhone) continue;
        try {
          const sms = formatReminderSms(r.restaurant.name, r.reservedAt, r.partySize);
          await sendSms(r.customerPhone, sms);
          await db.reservation.update({
            where: { id: r.id },
            data: {
              confirmationStatus: 'PENDING',
              confirmationSentAt: new Date(),
            },
          });
          sent++;
        } catch (err: any) {
          log.error({ err: err.message, reservationId: r.id }, 'failed to send reminder SMS');
        }
      }
      log.info({ sent, total: reservations.length }, 'rappel scan complete');
      return { sent, total: reservations.length };
    }

    if (data.kind === 'send' && data.reservationId) {
      const r = await db.reservation.findUniqueOrThrow({
        where: { id: data.reservationId },
        include: { restaurant: { select: { name: true } } },
      });
      if (!r.customerPhone) {
        log.warn({ reservationId: r.id }, 'no customer phone, skipping');
        return;
      }
      const sms = formatReminderSms(r.restaurant.name, r.reservedAt, r.partySize);
      await sendSms(r.customerPhone, sms);
      await db.reservation.update({
        where: { id: r.id },
        data: {
          confirmationStatus: 'PENDING',
          confirmationSentAt: new Date(),
        },
      });
      log.info({ reservationId: r.id }, 'reminder SMS sent');
      return;
    }
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(confirmationSmsWorker);
