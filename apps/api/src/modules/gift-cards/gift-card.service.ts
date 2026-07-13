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
import { generateUniqueShortCode } from './gift-card-code.util.js';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../shared/db/transaction-options';
import { createRefund } from './stripe.service.js';

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

    // Générer un shortCode unique (alias public lisible).
    // En cas de collision P2002 (race entre findUnique et create), on retente
    // avec un nouveau shortCode.
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const shortCode = await generateUniqueShortCode(this.prisma);
      try {
        return await this.prisma.giftCard.create({
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
            shortCode,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          continue;
        }
        throw err;
      }
    }

    throw new GiftCardError('Impossible de générer un shortCode unique');
  }

  /**
   * Recherche une carte par shortCode (alias public) ou par code UUID.
   */
  async findByShortCode(shortCode: string): Promise<GiftCard | null> {
    return this.prisma.giftCard.findUnique({
      where: { shortCode },
    });
  }

  /**
   * Recherche une carte par code (UUID) OU par shortCode (alias public).
   * Essaie d'abord le shortCode (format court), puis retombe sur le code UUID.
   */
  async findByCodeOrShortCode(identifier: string): Promise<GiftCard | null> {
    // Si l'identifiant ressemble à un shortCode (commence par SKR-), on cherche par shortCode
    if (identifier.startsWith('SKR-')) {
      const card = await this.prisma.giftCard.findUnique({
        where: { shortCode: identifier },
      });
      if (card) return card;
    }
    // Sinon, on cherche par code UUID
    return this.prisma.giftCard.findUnique({
      where: { code: identifier },
    });
  }

  async validateCode(code: string, restaurantId?: string): Promise<GiftCardValidationResult> {
    // Accepter indifféremment le code UUID ou le shortCode (SKR-XXXX-XX)
    const giftCard = await this.findByCodeOrShortCode(code);

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

    const { updated, appliedAmount, complementAmount, paymentStatus } =
      await this.prisma.$transaction(async (tx) => {
        // Verrouiller la carte cadeau pour empêcher la double utilisation
        // concurrente (P0 RES-006).
        const [locked] = await tx.$queryRaw<
          {
            id: string;
            remainingAmount: Prisma.Decimal;
            status: string;
          }[]
        >(
          Prisma.sql`SELECT id, remaining_amount AS "remainingAmount", status FROM gift_cards WHERE id = ${giftCard.id} FOR UPDATE`,
        );

        if (!locked || locked.status !== 'ACTIVE' || locked.remainingAmount.lessThanOrEqualTo(0)) {
          throw new GiftCardError('Carte cadeau invalide : FULLY_REDEEMED');
        }

        const lockedRemaining = new Prisma.Decimal(locked.remainingAmount);
        const appliedAmount = Prisma.Decimal.min(lockedRemaining, reservationAmount);
        const remainingAmount = lockedRemaining.minus(appliedAmount);
        const complementAmount = reservationAmount.minus(appliedAmount);
        const newStatus = remainingAmount.greaterThan(0) ? 'ACTIVE' : 'REDEEMED';

        let paymentStatus: GiftCardApplicationResult['paymentStatus'];
        if (complementAmount.greaterThan(0)) {
          paymentStatus = 'COMPLEMENT_REQUIRED';
        } else if (remainingAmount.greaterThan(0)) {
          paymentStatus = 'PARTIAL';
        } else {
          paymentStatus = 'FULLY_COVERED';
        }

        await tx.giftCardRedemption.create({
          data: {
            giftCardId: giftCard.id,
            reservationId: input.reservationId,
            amount: appliedAmount,
          },
        });

        const updated = await tx.giftCard.update({
          where: { id: giftCard.id },
          data: {
            remainingAmount,
            status: newStatus,
          },
        });

        return { updated, appliedAmount, complementAmount, paymentStatus };
      }, DEFAULT_TRANSACTION_OPTIONS);

    return {
      reservationId: input.reservationId,
      giftCardId: updated.id,
      appliedAmount: appliedAmount.toNumber(),
      remainingAmount: updated.remainingAmount.toNumber(),
      paymentStatus,
      complementAmount: complementAmount.toNumber(),
    };
  }

  async cancel(
    giftCardId: string,
    restaurantId: string,
    actor = 'dashboard:system',
  ): Promise<GiftCard> {
    const giftCard = await this.prisma.giftCard.findFirst({
      where: { id: giftCardId, restaurantId },
      include: { redemptions: true },
    });

    if (!giftCard) {
      throw new GiftCardError('Carte cadeau introuvable');
    }

    if (giftCard.status === 'CANCELLED') {
      throw new GiftCardError('La carte cadeau est déjà annulée');
    }

    let refund: { id: string; amount: number } | undefined;
    if (giftCard.stripePaymentIntentId && giftCard.remainingAmount.greaterThan(0)) {
      const refundAmountCents = Math.round(giftCard.remainingAmount.toNumber() * 100);
      refund = await createRefund({
        paymentIntentId: giftCard.stripePaymentIntentId,
        amount: refundAmountCents,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.giftCard.update({
        where: { id: giftCardId },
        data: {
          status: 'CANCELLED',
          remainingAmount: 0,
          ...(refund ? { stripePaymentStatus: 'refunded' } : {}),
        },
      });

      await tx.reservationAuditLog.create({
        data: {
          event: 'gift_card_refunded',
          actor,
          metadata: {
            giftCardId: giftCard.id,
            stripePaymentIntentId: giftCard.stripePaymentIntentId,
            refundId: refund?.id,
            refundAmount: refund ? refund.amount / 100 : giftCard.remainingAmount.toNumber(),
            currency: giftCard.currency,
          } as object,
        },
      });

      return updated;
    }, DEFAULT_TRANSACTION_OPTIONS);
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

  /**
   * Recherche une carte avec pack par code UUID OU par shortCode.
   */
  async findByCodeOrShortCodeWithPack(identifier: string): Promise<GiftCardWithPack | null> {
    if (identifier.startsWith('SKR-')) {
      const card = await this.prisma.giftCard.findUnique({
        where: { shortCode: identifier },
        include: { pack: true },
      });
      if (card) return card as GiftCardWithPack;
    }
    return this.prisma.giftCard.findUnique({
      where: { code: identifier },
      include: { pack: true },
    }) as Promise<GiftCardWithPack | null>;
  }

  private addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }
}
