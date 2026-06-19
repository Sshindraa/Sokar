import { Worker } from 'bullmq';
import { redisQueue } from '../../redis/client';
import { sendSms } from '../../telnyx/client';
import { setupWorkerListeners, jobLogger } from './helper';

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
    log.info({ reservationId: data.reservationId }, 'outbound confirmation sent');
  },
  { connection: redisQueue, concurrency: 5 },
);

setupWorkerListeners(outboundConfirmWorker);
