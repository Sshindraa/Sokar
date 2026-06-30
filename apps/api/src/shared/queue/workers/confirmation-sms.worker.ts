import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendReminder } from '../../messaging/sender';
import { setupWorkerListeners, jobLogger } from './helper';

/**
 * Worker pour l'envoi des rappels de réservation J-1.
 *
 * Canal : WhatsApp (utility template) si configuré, sinon SMS.
 * Le fallback est automatique — voir shared/messaging/sender.ts.
 *
 * Jobs :
 * 1. { kind: 'scan' } — Scanne les réservations de demain et envoie un rappel.
 * 2. { kind: 'send', reservationId } — Envoie un rappel pour une résa spécifique.
 */

interface ConfirmationSmsJobData {
  kind: 'scan' | 'send';
  reservationId?: string;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
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
      let whatsappCount = 0;
      let smsCount = 0;
      for (const r of reservations) {
        if (!r.customerPhone) continue;
        try {
          const result = await sendReminder({
            to: r.customerPhone,
            restaurantName: r.restaurant.name,
            restaurantId: r.restaurantId,
            reservationId: r.id,
            customerId: r.customerId ?? undefined,
            date: formatDate(r.reservedAt),
            time: formatTime(r.reservedAt),
            partySize: r.partySize,
          });
          if (result.success) {
            sent++;
            if (result.channel === 'whatsapp') whatsappCount++;
            else smsCount++;
            // Marquer PENDING uniquement si le rappel a effectivement été envoyé.
            // Sinon on garde le statut inchangé pour retry au prochain scan.
            await db.reservation.update({
              where: { id: r.id },
              data: {
                confirmationStatus: 'PENDING',
                confirmationSentAt: new Date(),
              },
            });
          } else {
            log.warn(
              { reservationId: r.id, channel: result.channel, error: result.error },
              'reminder send failed, status not updated — will retry next scan',
            );
          }
        } catch (err: any) {
          log.error({ err: err.message, reservationId: r.id }, 'failed to send reminder');
        }
      }
      log.info(
        { sent, whatsappCount, smsCount, total: reservations.length },
        'rappel scan complete',
      );
      return { sent, whatsappCount, smsCount, total: reservations.length };
    }

    if (data.kind === 'send' && data.reservationId) {
      const r = await db.reservation.findUniqueOrThrow({
        where: { id: data.reservationId },
        include: { restaurant: { select: { name: true, id: true } } },
      });
      if (!r.customerPhone) {
        log.warn({ reservationId: r.id }, 'no customer phone, skipping');
        return;
      }
      const result = await sendReminder({
        to: r.customerPhone,
        restaurantName: r.restaurant.name,
        restaurantId: r.restaurantId,
        reservationId: r.id,
        customerId: r.customerId ?? undefined,
        date: formatDate(r.reservedAt),
        time: formatTime(r.reservedAt),
        partySize: r.partySize,
      });
      if (result.success) {
        await db.reservation.update({
          where: { id: r.id },
          data: {
            confirmationStatus: 'PENDING',
            confirmationSentAt: new Date(),
          },
        });
        log.info({ reservationId: r.id, channel: result.channel }, 'reminder sent');
      } else {
        log.warn(
          { reservationId: r.id, channel: result.channel, error: result.error },
          'reminder send failed, status not updated',
        );
      }
      return;
    }
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(confirmationSmsWorker);
