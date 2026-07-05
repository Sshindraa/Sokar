/**
 * Gift card crowdfunding service — cagnottes pour cartes cadeaux.
 *
 * Flow :
 *   1. createCrowdfunding : crée une GiftCard type=CROWDFUNDED, amount=0, status=ACTIVE
 *   2. contribute : ajoute une GiftCardContribution (paiement Stripe vérifié)
 *   3. closeCrowdfunding : calcule le total, déduit la commission, met à jour la carte
 *      (amount = total - commission, remainingAmount = amount, status=ACTIVE, type=SINGLE)
 *   4. getPublicStatus : retourne le statut public de la cagnotte (sans auth)
 */
import type { PrismaClient, GiftCard, GiftCardContribution } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { GiftCardService } from './gift-card.service';
import { retrievePaymentIntent } from './stripe.service';
import {
  sendContributionConfirmation,
  sendCrowdfundingContributionNotification,
  sendCrowdfundingClosed,
} from './gift-card-email.service';
import { sendRecipientWhatsApp } from './gift-card-whatsapp.service';
import { logger } from '../../shared/logger/pino';
import type {
  CreateCrowdfundingInput,
  ContributeInput,
  PublicCrowdfundingStatus,
  PublicContribution,
} from './gift-card.types';

export class CrowdfundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrowdfundingError';
  }
}

export class GiftCardCrowdfundingService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Crée une cagnotte (GiftCard type=CROWDFUNDED, amount=0).
   * Le `title` est stocké dans `occasion`, le `message` dans `message`.
   * Le créateur est stocké dans `senderName` / `senderEmail`.
   */
  async createCrowdfunding(input: CreateCrowdfundingInput): Promise<GiftCard> {
    if (input.crowdfundedUntil <= new Date()) {
      throw new CrowdfundingError('La date butoir doit être dans le futur');
    }

    const service = new GiftCardService(this.prisma);
    return service.create({
      restaurantId: input.restaurantId,
      amount: 0,
      type: 'CROWDFUNDED',
      targetAmount: input.targetAmount,
      crowdfundedUntil: input.crowdfundedUntil,
      occasion: input.title,
      senderName: input.creatorName,
      senderEmail: input.creatorEmail,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      message: input.message,
      templateId: input.templateId,
      createdBy: 'CLIENT',
      purchaseReference: 'crowdfunding',
    });
  }

  /**
   * Contribue à une cagnotte.
   * Vérifie le PaymentIntent Stripe, la deadline, et le statut de la cagnotte.
   */
  async contribute(input: ContributeInput, paymentIntentId: string): Promise<GiftCardContribution> {
    // 1. Charger la cagnotte (lecture initiale pour validation rapide)
    const card = await this.prisma.giftCard.findUnique({
      where: { code: input.code },
    });

    if (!card) {
      throw new CrowdfundingError('Cagnotte introuvable');
    }

    if (card.type !== 'CROWDFUNDED') {
      throw new CrowdfundingError("Cette carte cadeau n'est pas une cagnotte");
    }

    if (card.status === 'CLOSED') {
      throw new CrowdfundingError('Cette cagnotte est clôturée');
    }

    if (card.status === 'CANCELLED') {
      throw new CrowdfundingError('Cette cagnotte est annulée');
    }

    // 2. Vérifier la deadline
    if (card.crowdfundedUntil && new Date() > card.crowdfundedUntil) {
      throw new CrowdfundingError('La date butoir de cette cagnotte est dépassée');
    }

    // 3. Vérifier le PaymentIntent Stripe (avant la transaction)
    const pi = await retrievePaymentIntent(paymentIntentId);
    if (pi.status !== 'succeeded') {
      throw new CrowdfundingError(`Le paiement n'est pas confirmé (statut: ${pi.status})`);
    }

    // 4. Transaction atomique : revérifier le statut + créer la contribution
    //    Cela évite la race condition où la cagnotte est clôturée entre
    //    la lecture initiale et la création de la contribution.
    const contribution = await this.prisma.$transaction(async (tx) => {
      // Revérifier atomiquement que la cagnotte est toujours active
      const activeCard = await tx.giftCard.findFirst({
        where: { id: card.id, type: 'CROWDFUNDED', status: 'ACTIVE' },
        select: { id: true },
      });

      if (!activeCard) {
        // La cagnotte n'est plus active (clôturée ou annulée entre-temps)
        throw new CrowdfundingError("Cette cagnotte n'est plus active");
      }

      // Créer la contribution dans la même transaction
      return tx.giftCardContribution.create({
        data: {
          giftCardId: card.id,
          contributorName: input.contributorName,
          contributorEmail: input.contributorEmail ?? null,
          amount: new Prisma.Decimal(input.amount),
          stripePaymentIntentId: paymentIntentId,
          isPublicName: input.isPublicName,
          message: input.message ?? null,
        },
      });
    });

    // 5. Notifications (non-bloquantes)
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: card.restaurantId },
      select: { name: true },
    });
    const restaurantName = restaurant?.name ?? 'Restaurant';

    const title = card.occasion ?? 'Cagnotte';

    await Promise.allSettled([
      // Email au contributeur
      sendContributionConfirmation({
        to: input.contributorEmail ?? '',
        contributorName: input.contributorName,
        amount: input.amount,
        title,
        recipientName: card.recipientName ?? '',
        restaurantName,
        code: card.code,
      }),
      // Email au créateur
      sendCrowdfundingContributionNotification({
        to: card.senderEmail ?? '',
        creatorName: card.senderName ?? '',
        contributorName: input.isPublicName ? input.contributorName : 'Anonyme',
        amount: input.amount,
        title,
        recipientName: card.recipientName ?? '',
        restaurantName,
        code: card.code,
      }),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === 'rejected') {
          logger.warn(
            { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
            '[crowdfunding] Notification email failed',
          );
        }
      }
    });

    return contribution;
  }

  /**
   * Clôture une cagnotte et transforme en carte cadeau utilisable.
   *
   * - Calcule le total des contributions
   * - Déduit la commission Sokar (5% par défaut, configurable sur le restaurant)
   * - Met à jour la GiftCard : amount = total - commission, remainingAmount = amount,
   *   type = SINGLE, status = ACTIVE, closedAt = now
   * - Envoie email + WhatsApp au destinataire avec le code final
   */
  async closeCrowdfunding(giftCardId: string): Promise<GiftCard> {
    const card = await this.prisma.giftCard.findUnique({
      where: { id: giftCardId },
      include: { contributions: true },
    });

    if (!card) {
      throw new CrowdfundingError('Cagnotte introuvable');
    }

    if (card.type !== 'CROWDFUNDED') {
      throw new CrowdfundingError("Cette carte cadeau n'est pas une cagnotte");
    }

    if (card.status === 'CLOSED') {
      throw new CrowdfundingError('Cette cagnotte est déjà clôturée');
    }

    // Calculer le total des contributions
    const totalCollected = card.contributions.reduce((sum, c) => sum + c.amount.toNumber(), 0);

    // Charger le restaurant pour le taux de commission
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: card.restaurantId },
      select: {
        name: true,
        giftCardCommissionRate: true,
        managerEmail: true,
        managerPhone: true,
      },
    });

    if (!restaurant) {
      throw new CrowdfundingError('Restaurant introuvable');
    }

    const commissionRate = restaurant.giftCardCommissionRate
      ? restaurant.giftCardCommissionRate.toNumber()
      : 0.05;
    const commissionAmount = Math.round(totalCollected * commissionRate * 100) / 100;
    const finalAmount = Math.round((totalCollected - commissionAmount) * 100) / 100;

    // Mettre à jour la carte
    const updated = await this.prisma.giftCard.update({
      where: { id: giftCardId },
      data: {
        type: 'SINGLE',
        status: 'ACTIVE',
        amount: new Prisma.Decimal(finalAmount),
        remainingAmount: new Prisma.Decimal(finalAmount),
        sokarCommissionAmount: new Prisma.Decimal(commissionAmount),
        closedAt: new Date(),
      },
    });

    // Notifications (non-bloquantes)
    const publicCode = updated.shortCode ?? updated.code;
    const pdfUrl = `${process.env.API_URL ?? ''}/public/gift-cards/${publicCode}/pdf`;

    await Promise.allSettled([
      sendCrowdfundingClosed({
        to: card.recipientEmail ?? '',
        recipientName: card.recipientName ?? '',
        title: card.occasion ?? 'Cagnotte',
        totalCollected,
        commissionAmount,
        finalAmount,
        code: updated.code,
        shortCode: updated.shortCode,
        restaurantName: restaurant.name,
        pdfUrl,
      }),
      sendRecipientWhatsApp({
        to: card.recipientPhone ?? '',
        code: updated.shortCode ?? updated.code,
        amount: finalAmount,
        restaurantName: restaurant.name,
      }),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === 'rejected') {
          logger.warn(
            { err: r.reason instanceof Error ? r.reason.message : String(r.reason) },
            '[crowdfunding] Close notification failed',
          );
        }
      }
    });

    logger.info(
      { giftCardId, totalCollected, commissionAmount, finalAmount },
      '[crowdfunding] Cagnotte clôturée',
    );

    return updated;
  }

  /**
   * Statut public d'une cagnotte (accessible sans authentification).
   */
  async getPublicStatus(code: string): Promise<PublicCrowdfundingStatus> {
    const card = await this.prisma.giftCard.findUnique({
      where: { code },
      include: {
        contributions: { orderBy: { contributedAt: 'desc' } },
        restaurant: { select: { name: true } },
      },
    });

    if (!card) {
      throw new CrowdfundingError('Cagnotte introuvable');
    }

    if (card.type !== 'CROWDFUNDED') {
      throw new CrowdfundingError("Cette carte cadeau n'est pas une cagnotte");
    }

    const collectedAmount = card.contributions.reduce((sum, c) => sum + c.amount.toNumber(), 0);

    const publicContributions: PublicContribution[] = card.contributions
      .filter((c) => c.isPublicName || c.message)
      .map((c) => ({
        id: c.id,
        contributorName: c.isPublicName ? c.contributorName : null,
        amount: c.amount.toNumber(),
        message: c.message,
        contributedAt: c.contributedAt.toISOString(),
      }));

    return {
      code: card.code,
      shortCode: card.shortCode,
      title: card.occasion ?? 'Cagnotte',
      occasion: card.occasion,
      recipientName: card.recipientName ?? '',
      restaurantName: card.restaurant.name,
      collectedAmount,
      targetAmount: card.targetAmount?.toNumber() ?? null,
      contributionsCount: card.contributions.length,
      crowdfundedUntil: card.crowdfundedUntil?.toISOString() ?? null,
      status: card.status as PublicCrowdfundingStatus['status'],
      contributions: publicContributions,
      creatorName: card.senderName ?? '',
      message: card.message,
    };
  }
}
