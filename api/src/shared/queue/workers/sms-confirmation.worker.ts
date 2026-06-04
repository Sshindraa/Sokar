import { Worker }  from 'bullmq';
import { redisQueue, redisSession } from '../../redis/client';
import telnyx from '../../telnyx/client';

// Vérifier le rate-limit Redis par restaurant avant d'envoyer
async function checkManagerSmsRateLimit(restaurantId: string): Promise<boolean> {
  const key = `sms:manager:${restaurantId}`;
  const last = await redisSession.get(key);
  if (last) return false; // encore dans la fenêtre
  await redisSession.set(key, Date.now().toString(), 'EX', Number(process.env.SMS_RATE_LIMIT_SECONDS ?? 900));
  return true;
}

export const smsManagerWorker = new Worker('sms-manager', async (job) => {
  const { restaurantId, message, phoneNumber } = job.data;

  const allowed = await checkManagerSmsRateLimit(restaurantId);
  if (!allowed) {
    console.warn(`[SMS] Manager alert rate-limited for restaurant ${restaurantId}`);
    return;
  }

  let to = phoneNumber;
  if (!to) {
    const { db } = await import('../../db/client');
    const r = await db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    to = r.managerPhone;
  }

  await telnyx.messages.create({ from: process.env.TELNYX_FROM_NUMBER!, to, text: message });
}, { connection: redisQueue });
