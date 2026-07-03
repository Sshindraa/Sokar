/**
 * Gift card payment service — orchestre le paiement Stripe + création de carte + notifications.
 *
 * Flow :
 *   1. Vérifier que le PaymentIntent Stripe est succeeded
 *   2. Calculer la commission Sokar = amount * restaurant.giftCardCommissionRate
 *   3. Créer la GiftCard avec stripePaymentIntentId, stripePaymentStatus, sokarCommissionAmount
 *   4. Déclencher les notifications (email expéditeur, email destinataire, WhatsApp, notif restaurateur)
 */
import type { PrismaClient, GiftCard } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { GiftCardService } from './gift-card.service';
import { retrievePaymentIntent } from './stripe.service';
import {
  sendSenderReceipt,
  sendRecipientGiftCard,
  sendRestaurantSaleNotification,
} from './gift-card-email.service';
import { sendRecipientWhatsApp } from './gift-card-whatsapp.service';
import { sendSms } from '../../shared/telnyx/client';
import { logger } from '../../shared/logger/pino';

export type PurchaseWithPaymentInput = {
  restaurantId: string;
  paymentIntentId: string;
  amount?: number;
  packId?: string;
  occasion?: string;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  recipientName?: string;
  recipientEmail?: string;
  recipientPhone?: string;
  message?: string;
  templateId?: string;
  customImageUrl?: string;
  preferredDate?: Date;
  preferredTime?: string;
  preferredPartySize?: number;
};

export class GiftCardPaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GiftCardPaymentError';
  }
}

export class GiftCardPaymentService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Paiement + création de carte + notifications.
   * Retourne la carte cadeau créée.
   */
  async purchaseWithPayment(input: PurchaseWithPaymentInput): Promise<GiftCard> {
    // 1. Vérifier le PaymentIntent Stripe
    const pi = await retrievePaymentIntent(input.paymentIntentId);
    if (pi.status !== 'succeeded') {
      throw new GiftCardPaymentError(`Le paiement n'est pas confirmé (statut: ${pi.status}).`);
    }

    // 2. Charger le restaurant pour le taux de commission et les infos
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: input.restaurantId },
      select: {
        name: true,
        giftCardCommissionRate: true,
        managerEmail: true,
        managerPhone: true,
        giftCardMinimumAmount: true,
      },
    });

    if (!restaurant) {
      throw new GiftCardPaymentError('Restaurant introuvable');
    }

    // 3. Déterminer le montant
    let amount: number;
    if (input.packId) {
      const pack = await this.prisma.giftCardPack.findFirst({
        where: { id: input.packId, restaurantId: input.restaurantId },
        select: { amount: true },
      });
      if (!pack) {
        throw new GiftCardPaymentError('Pack cadeau introuvable');
      }
      amount = pack.amount.toNumber();
    } else {
      if (input.amount == null || input.amount <= 0) {
        throw new GiftCardPaymentError('Le montant est requis et doit être positif');
      }
      amount = input.amount;
    }

    // Vérifier le montant minimum
    const minAmount = restaurant.giftCardMinimumAmount ?? 10;
    if (amount < minAmount) {
      throw new GiftCardPaymentError(`Le montant minimum est de ${minAmount}€`);
    }

    // 4. Calculer la commission
    const commissionRate = restaurant.giftCardCommissionRate
      ? restaurant.giftCardCommissionRate.toNumber()
      : 0.05;
    const sokarCommissionAmount = Math.round(amount * commissionRate * 100) / 100;

    // 5. Créer la carte cadeau
    const service = new GiftCardService(this.prisma);
    const card = await service.create({
      restaurantId: input.restaurantId,
      amount,
      packId: input.packId,
      occasion: input.occasion,
      senderName: input.senderName,
      senderEmail: input.senderEmail,
      senderPhone: input.senderPhone,
      recipientName: input.recipientName,
      recipientEmail: input.recipientEmail,
      recipientPhone: input.recipientPhone,
      message: input.message,
      createdBy: 'CLIENT',
      purchaseReference: input.paymentIntentId,
      stripePaymentIntentId: input.paymentIntentId,
      stripePaymentStatus: 'succeeded',
      templateId: input.templateId,
      customImageUrl: input.customImageUrl,
      sokarCommissionAmount,
      preferredDate: input.preferredDate,
      preferredTime: input.preferredTime,
      preferredPartySize: input.preferredPartySize,
    });

    // 6. Notifications (non-bloquantes — on log les erreurs mais on ne fait pas échouer l'achat)
    const pdfUrl = `${process.env.API_URL ?? ''}/public/gift-cards/${card.code}/pdf`;

    await Promise.allSettled([
      sendSenderReceipt({
        giftCardId: card.id,
        code: card.code,
        amount,
        restaurantName: restaurant.name,
        senderName: input.senderName ?? null,
        senderEmail: input.senderEmail ?? null,
        recipientName: input.recipientName ?? null,
        recipientEmail: input.recipientEmail ?? null,
        message: input.message ?? null,
        occasion: input.occasion ?? null,
        pdfUrl,
      }),
      sendRecipientGiftCard({
        giftCardId: card.id,
        code: card.code,
        amount,
        restaurantName: restaurant.name,
        senderName: input.senderName ?? null,
        senderEmail: input.senderEmail ?? null,
        recipientName: input.recipientName ?? null,
        recipientEmail: input.recipientEmail ?? null,
        message: input.message ?? null,
        occasion: input.occasion ?? null,
        pdfUrl,
      }),
      sendRestaurantSaleNotification({
        restaurantName: restaurant.name,
        restaurantEmail: restaurant.managerEmail,
        amount,
        commissionAmount: sokarCommissionAmount,
        senderName: input.senderName ?? null,
        recipientName: input.recipientName ?? null,
        giftCardId: card.id,
      }),
      sendRecipientWhatsApp({
        to: input.recipientPhone ?? '',
        code: card.code,
        amount,
        restaurantName: restaurant.name,
      }),
    ]);

    // Notification SMS au restaurateur (optionnel)
    if (restaurant.managerPhone) {
      try {
        await sendSms(
          restaurant.managerPhone,
          `Nouvelle vente carte cadeau ${amount}€ chez ${restaurant.name}. Commission: ${sokarCommissionAmount}€.`,
        );
      } catch (smsErr) {
        logger.warn(
          { err: smsErr instanceof Error ? smsErr.message : String(smsErr) },
          '[gift-card-payment] Restaurant SMS notification failed',
        );
      }
    }

    return card;
  }

  /**
   * Gère un webhook Stripe payment_intent.succeeded.
   *
   * Reconstruit un PurchaseWithPaymentInput complet à partir des metadata du
   * PaymentIntent et appelle purchaseWithPayment pour créer la carte + notifications.
   *
   * Idempotent : si une carte existe déjà pour ce PI, on la retourne sans recréer.
   * Si les metadata sont incomplètes (pas de restaurantId), on log un warning et
   * retourne null.
   */
  async handleStripeWebhook(
    paymentIntentId: string,
    metadata: Record<string, string>,
  ): Promise<GiftCard | null> {
    // Idempotence : vérifier si la carte existe déjà
    const existing = await this.prisma.giftCard.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
    });
    if (existing) {
      logger.info(
        { paymentIntentId, giftCardId: existing.id },
        '[gift-card-payment] Webhook: card already exists, skipping (idempotent)',
      );
      return existing;
    }

    // Vérifier que les metadata contiennent au moins restaurantId
    if (!metadata.restaurantId) {
      logger.warn(
        { paymentIntentId },
        '[gift-card-payment] Webhook: no restaurantId in metadata, skipping',
      );
      return null;
    }

    // Reconstruire l'input à partir des metadata
    const input: PurchaseWithPaymentInput = {
      restaurantId: metadata.restaurantId,
      paymentIntentId,
    };

    if (metadata.amount) {
      input.amount = parseFloat(metadata.amount);
    }
    if (metadata.packId) {
      input.packId = metadata.packId;
    }
    if (metadata.occasion) {
      input.occasion = metadata.occasion;
    }
    if (metadata.senderName) {
      input.senderName = metadata.senderName;
    }
    if (metadata.senderEmail) {
      input.senderEmail = metadata.senderEmail;
    }
    if (metadata.senderPhone) {
      input.senderPhone = metadata.senderPhone;
    }
    if (metadata.recipientName) {
      input.recipientName = metadata.recipientName;
    }
    if (metadata.recipientEmail) {
      input.recipientEmail = metadata.recipientEmail;
    }
    if (metadata.recipientPhone) {
      input.recipientPhone = metadata.recipientPhone;
    }
    if (metadata.message) {
      input.message = metadata.message;
    }
    if (metadata.templateId) {
      input.templateId = metadata.templateId;
    }
    if (metadata.customImageUrl) {
      input.customImageUrl = metadata.customImageUrl;
    }
    if (metadata.preferredDate) {
      input.preferredDate = new Date(metadata.preferredDate);
    }
    if (metadata.preferredTime) {
      input.preferredTime = metadata.preferredTime;
    }
    if (metadata.preferredPartySize) {
      input.preferredPartySize = parseInt(metadata.preferredPartySize, 10);
    }

    // Vérifier que l'on a soit amount soit packId
    if (!input.amount && !input.packId) {
      logger.warn(
        { paymentIntentId, metadata },
        '[gift-card-payment] Webhook: incomplete metadata (no amount or packId), skipping',
      );
      return null;
    }

    logger.info(
      { paymentIntentId, restaurantId: input.restaurantId },
      '[gift-card-payment] Webhook: reconstructing purchase from metadata',
    );

    return this.purchaseWithPayment(input);
  }
}
