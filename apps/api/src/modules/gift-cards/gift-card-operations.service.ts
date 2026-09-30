import { Prisma, type PrismaClient, type GiftCardRedemption } from '@prisma/client';
import { giftCardAmountCents, lockGiftCard } from './gift-card-finance.util';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../shared/db/transaction-options';

export class GiftCardOperationError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}
export type GiftCardDebitInput = {
  restaurantId: string;
  giftCardId: string;
  billAmount: number;
  ticketReference: string;
  reservationId?: string;
  idempotencyKey: string;
  actor: string;
};
function receipt(row: GiftCardRedemption) {
  return {
    id: row.id,
    giftCardId: row.giftCardId,
    reservationId: row.reservationId,
    ticketReference: row.ticketReference,
    billAmount: row.billAmount!.toNumber(),
    appliedAmount: row.amount.toNumber(),
    remainingAmount: row.balanceAfter!.toNumber(),
    complementAmount: row.complementAmount!.toNumber(),
    redeemedAt: row.redeemedAt,
  };
}

export class GiftCardOperationsService {
  constructor(private readonly prisma: PrismaClient) {}
  async debit(input: GiftCardDebitInput) {
    input = { ...input, ticketReference: input.ticketReference.trim().toUpperCase() };
    if (!input.ticketReference || input.ticketReference.length > 64)
      throw new GiftCardOperationError('Référence du ticket invalide.', 400);
    const cents = giftCardAmountCents(input.billAmount);
    const operationKey = `gift-card-debit:${input.restaurantId}:${input.idempotencyKey}`;
    return this.prisma.$transaction(async (tx) => {
      // Serializes both a repeated request and the same bill presented with another card/key.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${operationKey}, 0))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`gift-card-ticket:${input.restaurantId}:${input.ticketReference}`}, 0))`;
      const existing = await tx.giftCardRedemption.findFirst({
        where: {
          OR: [
            { operationKey },
            { restaurantId: input.restaurantId, ticketReference: input.ticketReference },
          ],
        },
      });
      if (existing) {
        if (
          existing.giftCardId !== input.giftCardId ||
          !existing.billAmount?.equals(input.billAmount) ||
          existing.reservationId !== (input.reservationId ?? null) ||
          existing.ticketReference !== input.ticketReference
        ) {
          throw new GiftCardOperationError(
            'Ce ticket ou cette demande a déjà été enregistré avec des informations différentes.',
          );
        }
        return receipt(existing);
      }
      await lockGiftCard(tx, input.giftCardId);
      const card = await tx.giftCard.findFirst({
        where: { id: input.giftCardId, restaurantId: input.restaurantId },
      });
      if (!card) throw new GiftCardOperationError('Carte cadeau introuvable.', 404);
      if (
        card.currency.toUpperCase() !== 'EUR' ||
        card.status !== 'ACTIVE' ||
        card.remainingAmount.lte(0) ||
        (card.expiresAt && card.expiresAt <= new Date()) ||
        (card.type === 'CROWDFUNDED' && !card.closedAt) ||
        (card.stripePaymentIntentId &&
          !['succeeded', 'partially_refunded'].includes(card.stripePaymentStatus ?? ''))
      ) {
        throw new GiftCardOperationError(
          'Cette carte ne peut pas être débitée : vérifiez son statut, son solde et sa validité.',
        );
      }
      if (input.reservationId) {
        await tx.$executeRaw`SELECT id FROM reservations WHERE id = ${input.reservationId} FOR UPDATE`;
        const booking = await tx.reservation.findFirst({
          where: { id: input.reservationId, restaurantId: input.restaurantId },
        });
        if (!booking)
          throw new GiftCardOperationError('Réservation introuvable pour cet établissement.', 404);
        if (!['CONFIRMED', 'SEATED'].includes(booking.status))
          throw new GiftCardOperationError('Cette réservation est annulée ou marquée absente.');
        const snapshot = booking.giftCardRedemptionSnap as { giftCardId?: string } | null;
        if (snapshot?.giftCardId && snapshot.giftCardId !== card.id)
          throw new GiftCardOperationError('Une autre carte est associée à cette réservation.');
        if (await tx.giftCardRedemption.findFirst({ where: { reservationId: booking.id } })) {
          throw new GiftCardOperationError(
            'Un débit a déjà été enregistré pour cette réservation.',
          );
        }
      }
      const billAmount = new Prisma.Decimal(cents).div(100);
      const amount = Prisma.Decimal.min(card.remainingAmount, billAmount);
      const balanceAfter = card.remainingAmount.minus(amount);
      const complementAmount = billAmount.minus(amount);
      const redemption = await tx.giftCardRedemption.create({
        data: {
          giftCardId: card.id,
          restaurantId: input.restaurantId,
          reservationId: input.reservationId,
          operationKey,
          ticketReference: input.ticketReference,
          billAmount,
          amount,
          balanceAfter,
          complementAmount,
          actor: input.actor,
        },
      });
      await tx.giftCard.update({
        where: { id: card.id },
        data: {
          remainingAmount: balanceAfter,
          status: balanceAfter.gt(0) ? 'ACTIVE' : 'REDEEMED',
        },
      });
      if (input.reservationId)
        await tx.reservation.update({
          where: { id: input.reservationId },
          data: {
            giftCardComplementAmount: complementAmount,
            giftCardRedemptionSnap: {
              giftCardId: card.id,
              reservationId: input.reservationId,
              requestedAmount: input.billAmount,
              appliedAmount: amount.toNumber(),
              remainingAmount: balanceAfter.toNumber(),
              complementAmount: complementAmount.toNumber(),
              paymentStatus: complementAmount.gt(0)
                ? 'COMPLEMENT_REQUIRED'
                : balanceAfter.gt(0)
                  ? 'PARTIAL'
                  : 'FULLY_COVERED',
            },
          },
        });
      await tx.reservationAuditLog.create({
        data: {
          reservationId: input.reservationId,
          actor: input.actor,
          event: 'gift_card_redeemed',
          metadata: {
            giftCardId: card.id,
            restaurantId: input.restaurantId,
            redemptionId: redemption.id,
            amountCents: amount.mul(100).toNumber(),
          },
        },
      });
      return receipt(redemption);
    }, DEFAULT_TRANSACTION_OPTIONS);
  }

  async overview(restaurantId: string) {
    const [cards, entries, redemptions] = await Promise.all([
      this.prisma.giftCard.findMany({
        where: { restaurantId },
        select: {
          id: true,
          amount: true,
          remainingAmount: true,
          status: true,
          expiresAt: true,
          type: true,
          closedAt: true,
          stripePaymentIntentId: true,
          createdBy: true,
          stripePaymentStatus: true,
          currency: true,
        },
      }),
      this.prisma.giftCardPaymentEntry.findMany({ where: { restaurantId } }),
      this.prisma.giftCardRedemption.aggregate({
        where: { giftCard: { restaurantId } },
        _sum: { amount: true },
      }),
    ]);
    // Retained legacy rows are explicitly identified; they are never presented as reconciled receipts.
    const cardIds = cards.map((card) => card.id);
    const pendingRefunds = cardIds.length
      ? await this.prisma.giftCardRefundRequest.count({
          where: {
            giftCardId: { in: cardIds },
            status: { in: ['REQUESTED', 'pending', 'requires_action', 'failed', 'canceled'] },
          },
        })
      : 0;
    const capturedCents = entries.reduce((sum, entry) => sum + entry.amountCents, 0);
    const refundedCents = entries.reduce((sum, entry) => sum + entry.refundedAmountCents, 0);
    const now = new Date();
    const valid = cards.filter(
      (card) =>
        card.status === 'ACTIVE' &&
        card.currency.toUpperCase() === 'EUR' &&
        (!card.stripePaymentIntentId ||
          ['succeeded', 'partially_refunded'].includes(card.stripePaymentStatus ?? '')) &&
        (!card.expiresAt || card.expiresAt > now) &&
        (card.type !== 'CROWDFUNDED' || Boolean(card.closedAt)),
    );
    const openIds = new Set(
      cards
        .filter(
          (card) => card.type === 'CROWDFUNDED' && !card.closedAt && card.status !== 'CANCELLED',
        )
        .map((card) => card.id),
    );
    const sum = (values: Prisma.Decimal[]) =>
      values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)).toNumber();
    return {
      capturedAmount: capturedCents / 100,
      refundedAmount: refundedCents / 100,
      netCapturedAmount: (capturedCents - refundedCents) / 100,
      issuedAmount: sum(cards.map((card) => card.amount)),
      availableBalance: sum(valid.map((card) => card.remainingAmount)),
      blockedBalance: sum(
        cards
          .filter((card) =>
            ['REFUND_PENDING', 'REFUND_FAILED', 'REFUND_REVIEW', 'PAYMENT_REVIEW'].includes(
              card.status,
            ),
          )
          .map((card) => card.remainingAmount),
      ),
      openCrowdfundingAmount:
        entries
          .filter((entry) => openIds.has(entry.giftCardId))
          .reduce((total, entry) => total + entry.amountCents - entry.refundedAmountCents, 0) / 100,
      redeemedAmount: redemptions._sum.amount?.toNumber() ?? 0,
      manuallyIssuedAmount: sum(
        cards
          .filter(
            (card) =>
              card.createdBy === 'DASHBOARD' &&
              !card.stripePaymentIntentId &&
              card.type !== 'CROWDFUNDED',
          )
          .map((card) => card.amount),
      ),
      untrackedLegacyPayments: cards.filter(
        (card) =>
          card.stripePaymentIntentId &&
          !entries.some((entry) => entry.paymentIntentId === card.stripePaymentIntentId),
      ).length,
      pendingRefunds,
      trackedPaymentCount: entries.length,
    };
  }

  async detail(giftCardId: string, restaurantId: string) {
    const card = await this.prisma.giftCard.findFirst({
      where: { id: giftCardId, restaurantId },
      include: { pack: true },
    });
    if (!card) throw new GiftCardOperationError('Carte cadeau introuvable.', 404);
    const [redemptions, payments, refunds, deliveries, associatedReservations] = await Promise.all([
      this.prisma.giftCardRedemption.findMany({
        where: { giftCardId },
        orderBy: { redeemedAt: 'desc' },
      }),
      this.prisma.giftCardPaymentEntry.findMany({
        where: { giftCardId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.giftCardRefundRequest.findMany({
        where: { giftCardId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.giftCardDelivery.findMany({
        where: { restaurantId, giftCardId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      this.prisma.reservation.findMany({
        where: {
          restaurantId,
          status: { in: ['CONFIRMED', 'SEATED'] },
          giftCardRedemptionSnap: { path: ['giftCardId'], equals: giftCardId },
          giftCardRedemptions: { none: {} },
        },
        select: { id: true, reservedAt: true, customerName: true, partySize: true },
        orderBy: { reservedAt: 'desc' },
        take: 50,
      }),
    ]);
    return {
      card,
      associatedReservations,
      deliveries: deliveries.map((row) => ({
        id: row.id,
        kind: row.kind,
        channel: row.channel,
        status: row.status,
        attempts: row.attempts,
        providerMessageId: row.providerMessageId,
        sentAt: row.sentAt,
        lastErrorCode: row.lastErrorCode,
        createdAt: row.createdAt,
      })),
      redemptions: redemptions.map((row) => ({
        id: row.id,
        reservationId: row.reservationId,
        amount: row.amount.toNumber(),
        billAmount: row.billAmount?.toNumber() ?? null,
        remainingAmount: row.balanceAfter?.toNumber() ?? null,
        complementAmount: row.complementAmount?.toNumber() ?? null,
        ticketReference: row.ticketReference,
        redeemedAt: row.redeemedAt,
      })),
      payments: payments.map((row) => ({
        paymentIntentId: row.paymentIntentId,
        amount: row.amountCents / 100,
        refundedAmount: row.refundedAmountCents / 100,
        currency: row.currency,
        connectedAccount: Boolean(row.stripeAccountId),
        pendingRefund: row.pendingRefund,
        createdAt: row.createdAt,
      })),
      refunds: refunds.map((row) => ({
        id: row.id,
        amount: row.amountCents / 100,
        status: row.status,
        reason: row.reason,
        providerRefundId: row.stripeRefundId,
        createdAt: row.createdAt,
      })),
    };
  }
}
