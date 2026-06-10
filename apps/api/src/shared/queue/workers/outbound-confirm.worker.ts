import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { sendSms }    from '../../telnyx/client';
import { setupWorkerListeners } from './helper';

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
    const message = `Reservation confirmee - ${data.restaurantName} ${data.date} ${data.time} ${data.partySize}pers. Annulation: appelez le restaurant.`;
    await sendSms(data.customerPhone, message);
  },
  { connection: redisQueue, concurrency: 5 },
);

setupWorkerListeners(outboundConfirmWorker);
