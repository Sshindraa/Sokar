import { recoverGiftCardDeliveries } from '../gift-card-delivery.service';
import { Worker } from 'bullmq';
import { logger } from '../../../shared/logger/pino';
import { db } from '../../../shared/db/client';
import { redisQueue } from '../../../shared/redis/client';
import { setupWorkerListeners } from '../../../shared/queue/workers/helper';
import { GiftCardCheckoutService } from '../gift-card-checkout.service';
import { GiftCardPaymentService } from '../gift-card-payment.service';
import { GiftCardCrowdfundingService } from '../gift-card-crowdfunding.service';
import { GiftCardRefundService } from '../gift-card-refund.service';
import { retrievePaymentIntent } from '../stripe.service';
import type { ContributeInput } from '../gift-card.types';

export async function reconcileGiftCardFinance(prisma = db) {
  await recoverGiftCardDeliveries(prisma);
  const refunds = await prisma.giftCardRefundRequest.findMany({
    where: { status: { in: ['REQUESTED', 'pending', 'requires_action'] } },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
  let failures = 0;
  for (const refund of refunds) {
    try {
      await new GiftCardRefundService(prisma).process(refund.id);
    } catch {
      failures++;
      logger.error({ refundRequestId: refund.id }, 'Gift card refund reconciliation failed');
    } finally {
      await prisma.giftCardRefundRequest.update({
        where: { id: refund.id },
        data: { updatedAt: new Date() },
      });
    }
  }
  // tenant-scoping: global — Privileged recovery scheduler scans all restaurants; each provider operation and update uses persisted account/tenant.
  const checkouts = await prisma.giftCardCheckout.findMany({
    where: { status: 'OPEN' },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
  for (const checkout of checkouts) {
    try {
      const paymentIntentId =
        checkout.stripePaymentIntentId ??
        (await new GiftCardCheckoutService(prisma).ensurePaymentIntent(checkout)).paymentIntentId;
      const pi = await retrievePaymentIntent(paymentIntentId, checkout.stripeAccountId);
      if (pi.status === 'canceled') {
        await prisma.giftCardCheckout.update({
          where: { id: checkout.id, restaurantId: checkout.restaurantId },
          data: { status: 'CANCELLED' },
        });
      } else if (pi.status === 'succeeded') {
        if (checkout.kind === 'PURCHASE') {
          await new GiftCardPaymentService(prisma).handleStripeWebhook(
            pi.id,
            pi.metadata,
            checkout.stripeAccountId,
          );
        } else {
          await new GiftCardCrowdfundingService(prisma).contribute(
            checkout.payload as unknown as ContributeInput,
            pi.id,
            { stripeAccountId: checkout.stripeAccountId, checkoutId: checkout.id },
          );
        }
      }
    } catch (error) {
      failures++;
      if (error instanceof Error && error.message === 'CHECKOUT_RECOVERY_EXPIRED') {
        await prisma.giftCardCheckout.update({
          where: { id: checkout.id, restaurantId: checkout.restaurantId },
          data: { status: 'RECOVERY_REQUIRED' },
        });
      }
      logger.error({ checkoutId: checkout.id }, 'Gift card checkout reconciliation failed');
    } finally {
      await prisma.giftCardCheckout.update({
        where: { id: checkout.id, restaurantId: checkout.restaurantId },
        data: { updatedAt: new Date() },
      });
    }
  }
  if (failures) throw new Error(`Gift card finance reconciliation: ${failures} failures`);
  return { refunds: refunds.length, checkouts: checkouts.length };
}

export const giftCardFinanceWorker = new Worker(
  'gift-card-finance',
  () => reconcileGiftCardFinance(),
  { connection: redisQueue, concurrency: 1 },
);
setupWorkerListeners(giftCardFinanceWorker);
