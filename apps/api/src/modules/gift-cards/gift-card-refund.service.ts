import { enqueueGiftCardDelivery } from './gift-card-delivery.service';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createRefund, retrieveRefund, retrievePaymentIntent } from './stripe.service';
import { lockGiftCard, lockGiftCardPayment } from './gift-card-finance.util';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../shared/db/transaction-options';

export class GiftCardRefundService {
  constructor(private readonly prisma: PrismaClient) {}

  async cancel(giftCardId: string, restaurantId: string, actor: string) {
    const card = await this.prisma.$transaction(async (tx) => {
      await lockGiftCard(tx, giftCardId);
      const card = await tx.giftCard.findFirst({
        where: { id: giftCardId, restaurantId },
        include: { contributions: true },
      });
      if (!card) throw new Error('Carte cadeau introuvable');
      if (card.status === 'CANCELLED') return card;
      if (card.status === 'REFUND_PENDING' || card.status === 'REFUND_FAILED') return card;
      const entries = await tx.giftCardPaymentEntry.findMany({
        where: { giftCardId, restaurantId },
      });
      const payments = card.contributions.length
        ? card.contributions
            .filter((c) => c.stripePaymentIntentId)
            .map((c) => ({ id: c.stripePaymentIntentId!, cents: c.amount.mul(100).toNumber() }))
        : card.stripePaymentIntentId && card.remainingAmount.gt(0)
          ? [{ id: card.stripePaymentIntentId, cents: card.remainingAmount.mul(100).toNumber() }]
          : [];
      // Crowdfunding cannot be refunded after consumption without attributing each contributor's share.
      if (
        card.contributions.length &&
        card.amount.gt(0) &&
        !card.remainingAmount.equals(card.amount)
      ) {
        throw new Error(
          'Une cagnotte partiellement utilisée nécessite un remboursement contrôlé par le support.',
        );
      }
      let refundCount = 0;
      for (const payment of payments) {
        const entry = entries.find((e) => e.paymentIntentId === payment.id);
        const cents = card.contributions.length
          ? Math.max(0, payment.cents - (entry?.refundedAmountCents ?? 0))
          : payment.cents;
        if (!cents) continue;
        refundCount++;
        await tx.giftCardRefundRequest.upsert({
          where: { idempotencyKey: `gift-card-cancel:${card.id}:${payment.id}` },
          update: {},
          create: {
            giftCardId: card.id,
            paymentIntentId: payment.id,
            amountCents: cents,
            stripeAccountId: entry?.stripeAccountId,
            actor,
            idempotencyKey: `gift-card-cancel:${card.id}:${payment.id}`,
          },
        });
      }
      const updated = await tx.giftCard.update({
        where: { id: card.id, restaurantId: card.restaurantId },
        data: {
          status: refundCount ? 'REFUND_PENDING' : 'CANCELLED',
          ...(refundCount ? {} : { remainingAmount: 0 }),
        },
      });
      await tx.reservationAuditLog.create({
        data: {
          event: 'gift_card_cancellation_requested',
          actor,
          metadata: { giftCardId: card.id, restaurantId, paymentCount: refundCount },
        },
      });
      return updated;
    }, DEFAULT_TRANSACTION_OPTIONS);
    if (card.status === 'CANCELLED') return card;
    const requests = await this.prisma.giftCardRefundRequest.findMany({
      where: {
        giftCardId,
        reason: 'CANCELLATION',
        status: { in: ['REQUESTED', 'pending', 'requires_action'] },
      },
    });
    for (const request of requests) await this.process(request.id);
    return this.prisma.giftCard.findUniqueOrThrow({ where: { id: giftCardId, restaurantId } });
  }

  async refundRejectedContribution(input: {
    giftCardId: string;
    paymentIntentId: string;
    amountCents: number;
    stripeAccountId?: string;
  }) {
    const request = await this.prisma.giftCardRefundRequest.upsert({
      where: { idempotencyKey: `gift-card-rejected:${input.paymentIntentId}` },
      update: {},
      create: {
        ...input,
        actor: 'stripe:webhook',
        reason: 'REJECTED_CONTRIBUTION',
        idempotencyKey: `gift-card-rejected:${input.paymentIntentId}`,
      },
    });
    await this.process(request.id);
  }

  async process(requestId: string) {
    const request = await this.prisma.giftCardRefundRequest.findUniqueOrThrow({
      where: { id: requestId },
    });
    if (['succeeded', 'failed', 'canceled'].includes(request.status)) return;
    // The stable provider key recovers a crash after Stripe accepted the request.
    const refund = request.stripeRefundId
      ? await retrieveRefund(request.stripeRefundId, request.stripeAccountId ?? undefined)
      : await createRefund({
          paymentIntentId: request.paymentIntentId,
          amount: request.amountCents,
          stripeAccountId: request.stripeAccountId ?? undefined,
          idempotencyKey: request.idempotencyKey,
        });
    if (refund.amount !== request.amountCents)
      throw new Error('Montant du remboursement incohérent');
    await this.prisma.$transaction(async (tx) => {
      await lockGiftCard(tx, request.giftCardId);
      const current = await tx.giftCardRefundRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      if (['succeeded', 'failed', 'canceled'].includes(current.status)) return;
      await tx.giftCardRefundRequest.update({
        where: { id: request.id },
        data: {
          stripeRefundId: refund.id,
          status: refund.status,
        },
      });
      if (request.reason !== 'CANCELLATION') {
        if (refund.status === 'succeeded') {
          // tenant-scoping: global — Privileged refund worker resolves card from its persisted request, not a caller-supplied tenant.
          const refundedCard = await tx.giftCard.findUnique({ where: { id: request.giftCardId } });
          if (refundedCard)
            await enqueueGiftCardDelivery(tx, {
              restaurantId: refundedCard.restaurantId,
              giftCardId: refundedCard.id,
              kind: 'refund_sender_email',
              referenceId: request.id,
            });
        }
        if (['succeeded', 'failed', 'canceled'].includes(refund.status))
          // tenant-scoping: global — Privileged refund worker updates only the unique payment from its persisted provider-verified refund request.
          await tx.giftCardCheckout.updateMany({
            where: { stripePaymentIntentId: request.paymentIntentId },
            data: { status: refund.status === 'succeeded' ? 'REFUNDED' : 'REFUND_FAILED' },
          });
        return;
      }
      const all = await tx.giftCardRefundRequest.findMany({
        where: { giftCardId: request.giftCardId, reason: 'CANCELLATION' },
      });
      if (all.some((r) => ['failed', 'canceled'].includes(r.status))) {
        // tenant-scoping: global — Privileged refund worker freezes only the card named in its persisted refund request.
        await tx.giftCard.update({
          where: { id: request.giftCardId },
          data: { status: 'REFUND_FAILED' },
        });
      } else if (all.length && all.every((r) => r.status === 'succeeded')) {
        // tenant-scoping: global — Privileged refund worker completes cancellation only for its persisted request card under a card lock.
        const card = await tx.giftCard.update({
          where: { id: request.giftCardId },
          data: {
            status: 'CANCELLED',
            remainingAmount: 0,
            stripePaymentStatus: 'refunded',
          },
        });
        await tx.reservationAuditLog.create({
          data: {
            event: 'gift_card_refunded',
            actor: request.actor,
            metadata: {
              giftCardId: request.giftCardId,
              refundIds: all.map((r) => r.stripeRefundId),
            },
          },
        });
        for (const entry of all)
          await enqueueGiftCardDelivery(tx, {
            restaurantId: card.restaurantId,
            giftCardId: card.id,
            kind: 'refund_sender_email',
            referenceId: entry.id,
          });
        await enqueueGiftCardDelivery(tx, {
          restaurantId: card.restaurantId,
          giftCardId: card.id,
          kind: 'refund_restaurant_email',
        });
      }
    }, DEFAULT_TRANSACTION_OPTIONS);
  }

  async reconcilePayment(paymentIntentId: string, stripeAccountId?: string) {
    const pi = await retrievePaymentIntent(paymentIntentId, stripeAccountId);
    const totalRefunded = pi.refundedAmount ?? 0;
    await this.prisma.$transaction(async (tx) => {
      await lockGiftCardPayment(tx, paymentIntentId);
      // tenant-scoping: global — Signed Stripe event bootstrap by unique payment; stored connected account must match provider account.
      let entry = await tx.giftCardPaymentEntry.findUnique({ where: { paymentIntentId } });
      if (entry && entry.stripeAccountId !== (stripeAccountId ?? null))
        throw new Error('Compte marchand incorrect');
      if (!entry) {
        if (stripeAccountId) {
          if (pi.metadata.checkoutId)
            await tx.giftCardCheckout.updateMany({
              where: {
                id: pi.metadata.checkoutId,
                stripeAccountId,
                restaurantId: pi.metadata.restaurantId,
                status: { in: ['OPEN', 'PAYMENT_REVIEW'] },
              },
              data: {
                status:
                  totalRefunded > 0 || pi.pendingRefund || pi.disputed ? 'PAYMENT_REVIEW' : 'OPEN',
              },
            });
          return;
        }
        // tenant-scoping: global — Legacy platform payment verified by Stripe identifies the card.
        const card = await tx.giftCard.findFirst({
          where: { stripePaymentIntentId: paymentIntentId },
        });
        const contribution = card
          ? null
          : await tx.giftCardContribution.findFirst({
              where: { stripePaymentIntentId: paymentIntentId },
            });
        if (!card && !contribution) return;
        entry = await tx.giftCardPaymentEntry.create({
          data: {
            paymentIntentId,
            giftCardId: card?.id ?? contribution!.giftCardId,
            restaurantId:
              card?.restaurantId ??
              // tenant-scoping: global — Legacy reconciliation derives tenant from the contribution already bound to the provider-verified payment.
              (await tx.giftCard.findUniqueOrThrow({ where: { id: contribution!.giftCardId } }))
                .restaurantId,
            contributionId: contribution?.id,
            kind: card ? 'PURCHASE' : 'CONTRIBUTION',
            amountCents: pi.amountReceived,
            currency: pi.currency,
          },
        });
      }
      await lockGiftCard(tx, entry.giftCardId);
      const card = await tx.giftCard.findUniqueOrThrow({
        where: { id: entry.giftCardId, restaurantId: entry.restaurantId },
      });
      const delta = Math.max(0, totalRefunded - entry.refundedAmountCents);
      await tx.giftCardPaymentEntry.update({
        where: { paymentIntentId, restaurantId: entry.restaurantId },
        data: {
          refundedAmountCents: Math.max(totalRefunded, entry.refundedAmountCents),
          pendingRefund: pi.pendingRefund ?? false,
        },
      });
      if (['REFUND_PENDING', 'REFUND_FAILED', 'CANCELLED'].includes(card.status)) return;
      const pending = await tx.giftCardPaymentEntry.findMany({
        where: { giftCardId: card.id, restaurantId: card.restaurantId, pendingRefund: true },
      });
      const remainingAmount = Prisma.Decimal.max(
        0,
        card.remainingAmount.minus(new Prisma.Decimal(delta).div(100)),
      );
      await tx.giftCard.update({
        where: { id: card.id, restaurantId: card.restaurantId },
        data: {
          remainingAmount,
          status: pi.disputed
            ? 'PAYMENT_REVIEW'
            : pending.length > 0
              ? 'REFUND_REVIEW'
              : remainingAmount.lte(0) &&
                  delta > 0 &&
                  !(card.type === 'CROWDFUNDED' && !card.closedAt)
                ? 'CANCELLED'
                : card.status === 'REFUND_REVIEW'
                  ? remainingAmount.gt(0) || (card.type === 'CROWDFUNDED' && !card.closedAt)
                    ? 'ACTIVE'
                    : 'REDEEMED'
                  : card.status,
          stripePaymentStatus: pi.disputed
            ? 'disputed'
            : totalRefunded >= pi.amountReceived
              ? 'refunded'
              : totalRefunded > 0
                ? 'partially_refunded'
                : card.stripePaymentStatus,
        },
      });
    }, DEFAULT_TRANSACTION_OPTIONS);
    const requests = await this.prisma.giftCardRefundRequest.findMany({
      where: { paymentIntentId, status: { in: ['REQUESTED', 'pending', 'requires_action'] } },
    });
    for (const request of requests) await this.process(request.id);
  }
}
