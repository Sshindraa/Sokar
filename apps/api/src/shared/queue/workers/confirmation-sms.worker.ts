import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { db } from '../../db/client';
import { sendSms } from '../../telnyx/client';
import { setupWorkerListeners, jobLogger } from './helper';

/**
 * Worker pour l'envoi des SMS de confirmation J-1.
 *
 * Deux types de jobs :
 * 1. { kind: 'scan' } — Scanne les réservations de demain et envoie un SMS
 *    à chaque client ayant un numéro de téléphone.
 * 2. { kind: 'send', reservationId } — Envoie un SMS pour une résa spécifique.
 * 3. { kind: 'noreply-check' } — Marque les réservations sans réponse comme NO_REPLY
 *    et notifie le gérant.
 */

interface ConfirmationSmsJobData {
  kind: 'scan' | 'send' | 'noreply-check';
  reservationId?: string;
}

function formatReservationSms(restaurantName: string, date: Date, partySize: number): string {
  const dateStr = date.toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const timeStr = date.toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${restaurantName}: votre réservation ${dateStr} à ${timeStr} pour ${partySize} pers. Confirmez en répondant OUI, annulez en répondant NON.`;
}

export const confirmationSmsWorker = new Worker(
  'confirmation-sms',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as ConfirmationSmsJobData;

    if (data.kind === 'scan') {
      // Scanne les réservations de demain
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

      log.info({ count: reservations.length }, 'confirmation scan: reservations to confirm');

      let sent = 0;
      for (const r of reservations) {
        if (!r.customerPhone) continue;
        try {
          const sms = formatReservationSms(r.restaurant.name, r.reservedAt, r.partySize);
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
          log.error({ err: err.message, reservationId: r.id }, 'failed to send confirmation SMS');
        }
      }
      log.info({ sent, total: reservations.length }, 'confirmation scan complete');
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
      const sms = formatReservationSms(r.restaurant.name, r.reservedAt, r.partySize);
      await sendSms(r.customerPhone, sms);
      await db.reservation.update({
        where: { id: r.id },
        data: {
          confirmationStatus: 'PENDING',
          confirmationSentAt: new Date(),
        },
      });
      log.info({ reservationId: r.id }, 'confirmation SMS sent');
      return;
    }

    if (data.kind === 'noreply-check') {
      // Marque les réservations PENDING d'aujourd'hui comme NO_REPLY
      // et notifie le gérant
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const noReplyReservations = await db.reservation.findMany({
        where: {
          status: 'CONFIRMED',
          reservedAt: { gte: todayStart, lte: todayEnd },
          confirmationStatus: 'PENDING',
        },
        include: {
          restaurant: { select: { id: true, name: true, managerPhone: true } },
        },
      });

      // Grouper par restaurant pour notifier les gérants
      const byRestaurant = new Map<string, typeof noReplyReservations>();
      for (const r of noReplyReservations) {
        const list = byRestaurant.get(r.restaurantId) ?? [];
        list.push(r);
        byRestaurant.set(r.restaurantId, list);
      }

      for (const [restaurantId, reservations] of byRestaurant) {
        // Marquer comme NO_REPLY
        await db.reservation.updateMany({
          where: {
            id: { in: reservations.map((r) => r.id) },
          },
          data: { confirmationStatus: 'NO_REPLY' },
        });

        // SMS au gérant
        const restaurant = reservations[0].restaurant;
        if (restaurant.managerPhone) {
          const count = reservations.length;
          const names = reservations
            .map(
              (r) =>
                `${r.customerName} (${r.partySize}p, ${r.reservedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })})`,
            )
            .join(', ');
          try {
            await sendSms(
              restaurant.managerPhone,
              `⚠️ ${count} réservation(s) non confirmée(s) aujourd'hui: ${names}. Appelez pour confirmer.`,
            );
          } catch (err: any) {
            log.error({ err: err.message, restaurantId }, 'failed to send manager notification');
          }
        }
      }

      log.info({ count: noReplyReservations.length }, 'noreply check complete');
      return { noreply: noReplyReservations.length };
    }
  },
  { connection: redisQueue, concurrency: 3 },
);

setupWorkerListeners(confirmationSmsWorker);
