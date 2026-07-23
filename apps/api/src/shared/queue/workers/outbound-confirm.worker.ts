import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { sendSms } from '../../telnyx/client';
import { db } from '../../db/client';
import { setupWorkerListeners, jobLogger } from './helper';
import { CONFIRMATION_SMS_SENT_EVENT } from '../../observability/system-checks';

export interface OutboundConfirmJobData {
  reservationId: string;
  customerPhone: string;
  customerName: string;
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
}

export const outboundConfirmWorker = new Worker(
  'sms-client',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as OutboundConfirmJobData;
    const message = `Reservation confirmee - ${data.restaurantName} ${data.date} ${data.time} ${data.partySize}pers. Annulation: appelez le restaurant.`;
    await sendSms(data.customerPhone, message);
    // Trace append-only de l'envoi réussi : le check « réservation sans SMS »
    // du worker system-health s'appuie sur cet audit (aucune table SmsLog).
    try {
      await db.reservationAuditLog.create({
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
  },
  { connection: redisQueue, concurrency: 5 },
);

setupWorkerListeners(outboundConfirmWorker);
