import { Worker } from 'bullmq';
import { redisQueue } from '../../../shared/redis/client';
import { db } from '../../../shared/db/client';
import { sendExpirationReminder } from '../gift-card-email.service';
import { setupWorkerListeners, jobLogger } from '../../../shared/queue/workers/helper';

interface GiftCardReminderJobData {
  kind: 'scan';
}

export const giftCardReminderWorker = new Worker(
  'gift-card-reminder',
  async (job) => {
    const log = jobLogger(job);
    const data = job.data as GiftCardReminderJobData;

    if (data.kind === 'scan') {
      const now = new Date();
      const thirtyDaysFromNow = new Date(now);
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      const cards = await db.giftCard.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { gte: now, lte: thirtyDaysFromNow },
          reminderSentAt: null,
          recipientEmail: { not: null },
        },
        include: { restaurant: { select: { name: true, id: true } } },
      });

      log.info({ count: cards.length }, 'gift-card-reminder scan: cards to remind');

      let sent = 0;
      for (const card of cards) {
        try {
          await sendExpirationReminder({
            giftCardId: card.id,
            code: card.code,
            shortCode: card.shortCode,
            amount: card.amount.toNumber(),
            remainingAmount: card.remainingAmount.toNumber(),
            restaurantName: card.restaurant.name,
            recipientName: card.recipientName,
            recipientEmail: card.recipientEmail!,
            expiresAt: card.expiresAt!,
          });

          await db.giftCard.update({
            where: { id: card.id },
            data: { reminderSentAt: new Date() },
          });
          sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.error({ err: message, giftCardId: card.id }, 'failed to send gift card reminder');
        }
      }

      log.info({ sent, total: cards.length }, 'gift-card-reminder scan complete');
      return { sent, total: cards.length };
    }
  },
  { connection: redisQueue, concurrency: 1 },
);

setupWorkerListeners(giftCardReminderWorker);
