import { Prisma, type PrismaClient, type GiftCardCheckout } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  createPaymentIntent,
  retrieveConnectedAccount,
  retrievePaymentIntent,
} from './stripe.service';
import { giftCardAmountCents, giftCardHash } from './gift-card-finance.util';
import type { PurchaseWithPaymentInput } from './gift-card-payment.service';
import type { ContributeInput } from './gift-card.types';

export type GiftCardCheckoutInput = Omit<PurchaseWithPaymentInput, 'paymentIntentId'> & {
  idempotencyKey?: string;
  accessToken?: string;
};

export class GiftCardCheckoutService {
  constructor(private readonly prisma: PrismaClient) {}

  async purchase(input: GiftCardCheckoutInput) {
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: input.restaurantId },
      select: {
        giftCardEnabled: true,
        giftCardMinimumAmount: true,
        giftCardCommissionRate: true,
        giftCardStripeAccountId: true,
      },
    });
    if (!restaurant?.giftCardEnabled)
      throw new Error('Cartes cadeaux non disponibles pour ce restaurant');
    const stripeAccountId = await this.readyAccount(restaurant.giftCardStripeAccountId);
    const pack = input.packId
      ? await this.prisma.giftCardPack.findFirst({
          where: {
            id: input.packId,
            restaurantId: input.restaurantId,
            isActive: true,
            deletedAt: null,
          },
        })
      : null;
    if (input.packId && !pack) throw new Error('Pack cadeau introuvable');
    const amount = pack ? pack.amount.toNumber() : input.amount;
    if (amount === undefined || amount < (restaurant.giftCardMinimumAmount ?? 10)) {
      throw new Error(`Le montant minimum est de ${restaurant.giftCardMinimumAmount ?? 10}€`);
    }
    const { accessToken: suppliedToken, idempotencyKey, ...details } = input;
    const payload = JSON.parse(
      JSON.stringify({
        ...details,
        amount,
        packSnapshot: pack
          ? {
              name: pack.name,
              description: pack.description,
              amount,
              minPartySize: pack.minPartySize,
              maxPartySize: pack.maxPartySize,
            }
          : null,
      }),
    ) as Prisma.InputJsonValue;
    return this.prepare({
      restaurantId: input.restaurantId,
      kind: 'PURCHASE',
      amountCents: giftCardAmountCents(amount),
      commissionRate: restaurant.giftCardCommissionRate ?? new Prisma.Decimal(0.05),
      payload,
      idempotencyKey,
      accessToken: suppliedToken,
      stripeAccountId,
    });
  }

  async contribution(input: ContributeInput & { idempotencyKey?: string; accessToken?: string }) {
    // tenant-scoping: global — Public contribution: the unique card code identifies the restaurant; no contact data is returned.
    const card = await this.prisma.giftCard.findUnique({ where: { code: input.code } });
    if (
      !card ||
      card.type !== 'CROWDFUNDED' ||
      card.closedAt ||
      card.status !== 'ACTIVE' ||
      (card.crowdfundedUntil && card.crowdfundedUntil <= new Date())
    ) {
      throw new Error("Cette cagnotte n'est plus active");
    }
    const restaurant = await this.prisma.restaurant.findUnique({
      where: { id: card.restaurantId },
      select: {
        giftCardEnabled: true,
        giftCardCommissionRate: true,
        giftCardStripeAccountId: true,
      },
    });
    if (!restaurant?.giftCardEnabled)
      throw new Error('Cartes cadeaux non disponibles pour ce restaurant');
    const stripeAccountId = await this.readyAccount(restaurant.giftCardStripeAccountId);
    const { accessToken, idempotencyKey, ...details } = input;
    return this.prepare({
      restaurantId: card.restaurantId,
      giftCardId: card.id,
      kind: 'CONTRIBUTION',
      amountCents: giftCardAmountCents(input.amount),
      commissionRate: restaurant.giftCardCommissionRate ?? new Prisma.Decimal(0.05),
      payload: details,
      idempotencyKey,
      accessToken,
      stripeAccountId,
    });
  }

  private async prepare(input: {
    restaurantId: string;
    giftCardId?: string;
    kind: string;
    amountCents: number;
    commissionRate: Prisma.Decimal;
    payload: Prisma.InputJsonValue;
    idempotencyKey?: string;
    accessToken?: string;
    stripeAccountId: string;
  }) {
    if (input.commissionRate.lt(0) || input.commissionRate.gt(1))
      throw new Error('Commission carte cadeau invalide.');
    const accessToken = input.accessToken ?? `${randomUUID()}${randomUUID()}`;
    const key = `gift-card:${input.restaurantId}:${input.kind}:${input.idempotencyKey ?? randomUUID()}`;
    const payloadHash = giftCardHash(JSON.stringify(input.payload));
    const accessTokenHash = giftCardHash(accessToken);
    const checkout = await this.prisma.giftCardCheckout.upsert({
      where: { idempotencyKey: key },
      update: {},
      create: {
        restaurantId: input.restaurantId,
        giftCardId: input.giftCardId,
        kind: input.kind,
        amountCents: input.amountCents,
        currency: 'eur',
        commissionRate: input.commissionRate,
        stripeAccountId: input.stripeAccountId,
        payload: input.payload,
        payloadHash,
        accessTokenHash,
        idempotencyKey: key,
      },
    });
    if (checkout.payloadHash !== payloadHash || checkout.accessTokenHash !== accessTokenHash) {
      throw new Error('Cette commande existe déjà avec des informations différentes.');
    }
    const intent = await this.ensurePaymentIntent(checkout);
    return {
      ...intent,
      accessToken,
      checkoutId: checkout.id,
      stripeAccountId: checkout.stripeAccountId,
    };
  }

  async ensurePaymentIntent(checkout: GiftCardCheckout) {
    if (checkout.stripePaymentIntentId) {
      const existing = await retrievePaymentIntent(
        checkout.stripePaymentIntentId,
        checkout.stripeAccountId,
      );
      if (!existing.clientSecret || existing.status === 'canceled')
        throw new Error('Cette tentative de paiement est terminée.');
      return { paymentIntentId: existing.id, clientSecret: existing.clientSecret };
    }
    // Stripe retains idempotency keys for at least 24h. Never recreate an unbound older intent.
    if (checkout.createdAt.getTime() < Date.now() - 23 * 60 * 60 * 1000)
      throw new Error('CHECKOUT_RECOVERY_EXPIRED');
    const intent = await createPaymentIntent({
      amount: checkout.amountCents,
      currency: checkout.currency,
      metadata: {
        type: checkout.kind === 'CONTRIBUTION' ? 'crowdfunding_contribution' : 'gift_card_purchase',
        checkoutId: checkout.id,
        restaurantId: checkout.restaurantId,
      },
      idempotencyKey: `gift-card-checkout:${checkout.id}`,
      stripeAccountId: checkout.stripeAccountId,
      applicationFeeAmount: new Prisma.Decimal(checkout.amountCents)
        .mul(checkout.commissionRate)
        .toDecimalPlaces(0)
        .toNumber(),
    });
    await this.prisma.giftCardCheckout.update({
      where: { id: checkout.id, restaurantId: checkout.restaurantId },
      data: { stripePaymentIntentId: intent.id },
    });
    return { paymentIntentId: intent.id, clientSecret: intent.clientSecret };
  }

  private async readyAccount(accountId: string | null) {
    if (!accountId)
      throw new Error(
        'Le restaurant doit connecter son compte Stripe avant de vendre des cartes cadeaux.',
      );
    const account = await retrieveConnectedAccount(accountId);
    if (!account.chargesEnabled || !account.payoutsEnabled)
      throw new Error("Le compte Stripe du restaurant n'est pas prêt à encaisser.");
    return account.id;
  }

  async findForPayment(
    metadata: Record<string, string>,
    paymentIntentId: string,
  ): Promise<GiftCardCheckout | null> {
    if (!metadata.checkoutId) return null;
    const checkout = await this.prisma.giftCardCheckout.findUnique({
      where: { id: metadata.checkoutId, restaurantId: metadata.restaurantId },
    });
    // A webhook can arrive before the optional PI reference update; the metadata is signed by Stripe.
    if (
      !checkout ||
      (checkout.stripePaymentIntentId && checkout.stripePaymentIntentId !== paymentIntentId) ||
      checkout.restaurantId !== metadata.restaurantId
    )
      throw new Error('Commande de paiement introuvable.');
    return checkout;
  }
}
