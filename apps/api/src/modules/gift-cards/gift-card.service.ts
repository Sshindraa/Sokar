import type { PrismaClient, GiftCard } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  type CreateGiftCardInput,
  type GiftCardValidationResult,
  type ApplyGiftCardInput,
  type GiftCardApplicationResult,
  type GiftCardStats,
  type GiftCardWithPack,
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
    let amount: Prisma.Decimal;
    const packId: string | null = input.packId ?? null;

    // Pour le crowdfunding (P3), le montant initial est 0 — il sera
    // alimenté par les contributions puis fixé à la clôture.
    if (input.type === 'CROWDFUNDED') {
      amount = new Prisma.Decimal(input.amount ?? 0);
    } else if (packId) {
      const pack = await this.prisma.giftCardPack.findFirst({
        where: { id: packId, restaurantId: input.restaurantId },
      });
      if (!pack) {
        throw new GiftCardError('Le pack cadeau est introuvable pour ce restaurant');
      }
      amount = pack.amount;
      if (input.amount && !new Prisma.Decimal(input.amount).equals(amount)) {
        throw new GiftCardError('Le montant doit correspondre au montant du pack');
      }
    } else {
      if (input.amount == null) {
        throw new GiftCardError('Le montant de la carte cadeau est requis');
      }
      amount = new Prisma.Decimal(input.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new GiftCardError('Le montant de la carte cadeau doit être supérieur à 0');
      }
    }

    const validityMonths = input.validityMonths ?? 12;
    const expiresAt = input.expiresAt ?? this.addMonths(new Date(), validityMonths);

    return this.prisma.giftCard.create({
      data: {
        restaurantId: input.restaurantId,
        amount,
        remainingAmount: amount,
        currency: input.currency ?? 'EUR',
        expiresAt,
        validityMonths,
        packId,
        preferredDate: input.preferredDate ?? null,
        preferredTime: input.preferredTime ?? null,
        preferredPartySize: input.preferredPartySize ?? null,
        senderName: input.senderName ?? null,
        senderEmail: input.senderEmail ?? null,
        senderPhone: input.senderPhone ?? null,
        recipientName: input.recipientName ?? null,
        recipientEmail: input.recipientEmail ?? null,
        recipientPhone: input.recipientPhone ?? null,
        message: input.message ?? null,
        occasion: input.occasion ?? null,
        customerId: input.customerId ?? null,
        createdBy: input.createdBy ?? 'CLIENT',
        purchaseReference: input.purchaseReference ?? null,
        stripePaymentIntentId: input.stripePaymentIntentId ?? null,
        stripePaymentStatus: input.stripePaymentStatus ?? 'pending',
        templateId: input.templateId ?? null,
        customImageUrl: input.customImageUrl ?? null,
        sokarCommissionAmount: input.sokarCommissionAmount ?? 0,
        type: input.type ?? 'SINGLE',
        targetAmount: input.targetAmount ?? null,
        crowdfundedUntil: input.crowdfundedUntil ?? null,
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
    const [totalSoldAgg, totalRemainingAgg, redeemedCount, activeCount, totalCount, packCount] =
      await Promise.all([
        this.prisma.giftCard.aggregate({ where: { restaurantId }, _sum: { amount: true } }),
        this.prisma.giftCard.aggregate({
          where: { restaurantId },
          _sum: { remainingAmount: true },
        }),
        this.prisma.giftCard.count({ where: { restaurantId, status: 'REDEEMED' } }),
        this.prisma.giftCard.count({ where: { restaurantId, status: 'ACTIVE' } }),
        this.prisma.giftCard.count({ where: { restaurantId } }),
        this.prisma.giftCard.count({ where: { restaurantId, packId: { not: null } } }),
      ]);

    const totalSoldAmount = totalSoldAgg._sum.amount?.toNumber() ?? 0;
    const totalRemainingAmount = totalRemainingAgg._sum.remainingAmount?.toNumber() ?? 0;
    const averageAmount = totalCount > 0 ? totalSoldAmount / totalCount : 0;
    const freeAmountCount = totalCount - packCount;

    return {
      totalSoldAmount,
      totalRemainingAmount,
      redeemedCount,
      activeCount,
      totalCount,
      averageAmount,
      packCount,
      freeAmountCount,
    };
  }

  async findByCodeWithPack(code: string): Promise<GiftCardWithPack | null> {
    return this.prisma.giftCard.findUnique({
      where: { code },
      include: { pack: true },
    }) as Promise<GiftCardWithPack | null>;
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }
}
