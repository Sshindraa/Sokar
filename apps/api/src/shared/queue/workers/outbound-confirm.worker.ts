import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { sendSms }    from '../../telnyx/client';

export interface OutboundConfirmJobData {
  reservationId:  string;
  customerPhone:  string;
  customerName:   string;
  restaurantName: string;
  date:           string;
  time:           string;
  partySize:      number;
}

export const outboundConfirmWorker = new Worker(
  'sms-client',
  async (job) => {
    const data = job.data as OutboundConfirmJobData;
    const message = [
      `✅ Réservation confirmée — ${data.restaurantName}`,
      `📅 ${data.date} à ${data.time} pour ${data.partySize} personne${data.partySize > 1 ? 's' : ''}`,
      `Au nom de : ${data.customerName}`,
      `Pour annuler, appelez directement le restaurant.`,
    ].join('\n');
    await sendSms(data.customerPhone, message);
  },
  { connection: redisQueue, concurrency: 5 },
);
