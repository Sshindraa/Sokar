import type { PrismaClient, GiftCard } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  type CreateGiftCardInput,
  type GiftCardValidationResult,
  type ApplyGiftCardInput,
  type GiftCardApplicationResult,
  type GiftCardStats,
} from './gift-card.types.js';

export class GiftCardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftCardError';
  }
}

export class GiftCardService {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateGiftCardInput): Promise<GiftCard> {
    const amount = new Prisma.Decimal(input.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new GiftCardError('Le montant de la carte cadeau doit être supérieur à 0');
    }

    return this.prisma.giftCard.create({
      data: {
        restaurantId: input.restaurantId,
        amount,
        remainingAmount: amount,
        currency: input.currency ?? 'EUR',
        expiresAt: input.expiresAt ?? null,
        senderName: input.senderName ?? null,
        senderEmail: input.senderEmail ?? null,
        senderPhone: input.senderPhone ?? null,
        recipientName: input.recipientName ?? null,
        recipientEmail: input.recipientEmail ?? null,
        recipientPhone: input.recipientPhone ?? null,
        message: input.message ?? null,
        voiceMessageUrl: input.voiceMessageUrl ?? null,
        occasion: input.occasion ?? null,
        customerId: input.customerId ?? null,
        createdBy: input.createdBy ?? 'CLIENT',
        purchaseReference: input.purchaseReference ?? null,
      },
    });
  }

  async validateCode(code: string, restaurantId?: string): Promise<GiftCardValidationResult> {
    const giftCard = await this.prisma.giftCard.findUnique({
      where: { code },
    });

    if (!giftCard) {
      return { valid: false, reason: 'NOT_FOUND' };
    }

    if (restaurantId && giftCard.restaurantId !== restaurantId) {
      return { valid: false, reason: 'WRONG_RESTAURANT' };
    }

    if (giftCard.status === 'CANCELLED') {
      return { valid: false, reason: 'CANCELLED' };
    }

    if (giftCard.status === 'EXPIRED') {
      return { valid: false, reason: 'EXPIRED' };
    }

    if (giftCard.status === 'REDEEMED' || giftCard.remainingAmount.lessThanOrEqualTo(0)) {
      return { valid: false, reason: 'FULLY_REDEEMED' };
    }

    if (giftCard.expiresAt && giftCard.expiresAt < new Date()) {
      return { valid: false, reason: 'EXPIRED' };
    }

    return { valid: true, giftCard };
  }

  async applyToReservation(input: ApplyGiftCardInput): Promise<GiftCardApplicationResult> {
    const validation = await this.validateCode(input.code, input.restaurantId);
    if (!validation.valid) {
      throw new GiftCardError(`Carte cadeau invalide : ${validation.reason}`);
    }

    const giftCard = validation.giftCard;
    const reservationAmount = new Prisma.Decimal(input.reservationAmount);
    const appliedAmount = Prisma.Decimal.min(giftCard.remainingAmount, reservationAmount);
    const remainingAmount = giftCard.remainingAmount.minus(appliedAmount);
    const complementAmount = reservationAmount.minus(appliedAmount);

    let paymentStatus: GiftCardApplicationResult['paymentStatus'];
    if (complementAmount.greaterThan(0)) {
      paymentStatus = 'COMPLEMENT_REQUIRED';
    } else if (remainingAmount.greaterThan(0)) {
      paymentStatus = 'PARTIAL';
    } else {
      paymentStatus = 'FULLY_COVERED';
    }

    const newStatus = remainingAmount.greaterThan(0) ? 'ACTIVE' : 'REDEEMED';

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.giftCardRedemption.create({
        data: {
          giftCardId: giftCard.id,
          reservationId: input.reservationId,
          amount: appliedAmount,
        },
      });

      return tx.giftCard.update({
        where: { id: giftCard.id },
        data: {
          remainingAmount,
          status: newStatus,
        },
      });
    });

    return {
      reservationId: input.reservationId,
      giftCardId: updated.id,
      appliedAmount: appliedAmount.toNumber(),
      remainingAmount: updated.remainingAmount.toNumber(),
      paymentStatus,
      complementAmount: complementAmount.toNumber(),
    };
  }

  async cancel(giftCardId: string, restaurantId: string): Promise<GiftCard> {
    const giftCard = await this.prisma.giftCard.findFirst({
      where: { id: giftCardId, restaurantId },
    });

    if (!giftCard) {
      throw new GiftCardError('Carte cadeau introuvable');
    }

    if (giftCard.status === 'CANCELLED') {
      throw new GiftCardError('La carte cadeau est déjà annulée');
    }

    return this.prisma.giftCard.update({
      where: { id: giftCardId },
      data: { status: 'CANCELLED', remainingAmount: 0 },
    });
  }

  async getStats(restaurantId: string): Promise<GiftCardStats> {
    const cards = await this.prisma.giftCard.findMany({
      where: { restaurantId },
    });

    const totalSoldAmount = cards.reduce((sum, card) => sum + card.amount.toNumber(), 0);
    const totalRemainingAmount = cards.reduce(
      (sum, card) => sum + card.remainingAmount.toNumber(),
      0,
    );
    const redeemedCount = cards.filter((card) => card.status === 'REDEEMED').length;
    const activeCount = cards.filter((card) => card.status === 'ACTIVE').length;
    const totalCount = cards.length;
    const averageAmount = totalCount > 0 ? totalSoldAmount / totalCount : 0;

    return {
      totalSoldAmount,
      totalRemainingAmount,
      redeemedCount,
      activeCount,
      totalCount,
      averageAmount,
    };
  }
}
