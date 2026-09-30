import type { PrismaClient } from '@prisma/client';
import { enqueue } from '../../shared/outbox/outbox.service';
import { DEFAULT_TRANSACTION_OPTIONS } from '../../shared/db/transaction-options';
import { lockGiftCard } from './gift-card-finance.util';
import { GiftCardOperationError } from './gift-card-operations.service';
import { enqueueGiftCardDelivery } from './gift-card-delivery.service';

export async function retryGiftCardDelivery(
  prisma: PrismaClient,
  restaurantId: string,
  giftCardId: string,
  deliveryId: string,
  actor: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockGiftCard(tx, giftCardId);
    const row = await tx.giftCardDelivery.findFirst({
      where: { id: deliveryId, restaurantId, giftCardId },
    });
    if (!row) throw new GiftCardOperationError('Envoi introuvable.', 404);
    if (!['FAILED', 'SKIPPED'].includes(row.status))
      throw new GiftCardOperationError(
        'Cet envoi ne peut pas être relancé. Vérifiez d’abord son résultat auprès du fournisseur.',
      );
    const changed = await tx.giftCardDelivery.updateMany({
      where: { id: row.id, restaurantId, status: row.status },
      data: { status: 'PENDING', providerMessageId: null, lastErrorCode: null, startedAt: null },
    });
    if (!changed.count)
      throw new GiftCardOperationError('L’état de cet envoi a changé. Actualisez son historique.');
    await enqueue(tx, {
      restaurantId,
      topic: 'gift-card-delivery',
      aggregateType: 'gift-card',
      aggregateId: giftCardId,
      eventType: row.kind,
      payload: { deliveryId },
      idempotencyKey: `gift-card-retry:${row.id}:${row.updatedAt.toISOString()}`,
    });
    await tx.reservationAuditLog.create({
      data: {
        actor,
        event: 'gift_card_delivery_retried',
        metadata: { giftCardId, deliveryId, restaurantId },
      },
    });
    return { status: 'PENDING' };
  }, DEFAULT_TRANSACTION_OPTIONS);
}

export async function resendGiftCardRecipient(
  prisma: PrismaClient,
  input: {
    restaurantId: string;
    giftCardId: string;
    channel: 'email' | 'whatsapp';
    idempotencyKey: string;
    actor: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    await lockGiftCard(tx, input.giftCardId);
    const card = await tx.giftCard.findFirst({
      where: { id: input.giftCardId, restaurantId: input.restaurantId },
    });
    if (!card) throw new GiftCardOperationError('Carte cadeau introuvable.', 404);
    if (
      !['ACTIVE', 'REDEEMED'].includes(card.status) ||
      (card.type === 'CROWDFUNDED' && !card.closedAt)
    )
      throw new GiftCardOperationError(
        'Cette carte ne peut pas être renvoyée dans son état actuel.',
      );
    if (input.channel === 'email' ? !card.recipientEmail : !card.recipientPhone)
      throw new GiftCardOperationError('Les coordonnées du destinataire sont manquantes.');
    const kind =
      input.channel === 'email'
        ? card.type === 'CROWDFUNDED'
          ? 'closure_email'
          : 'recipient_email'
        : 'recipient_whatsapp';
    const key = `gift-card-delivery:${card.id}:${kind}:card:${input.idempotencyKey}`;
    const previous = await tx.giftCardDelivery.findUnique({
      where: { idempotencyKey: key, restaurantId: input.restaurantId },
    });
    if (previous) return { id: previous.id, status: previous.status };
    const blocked = await tx.giftCardDelivery.findFirst({
      where: {
        giftCardId: card.id,
        restaurantId: input.restaurantId,
        kind,
        status: { in: ['PENDING', 'IN_PROGRESS', 'UNKNOWN', 'FAILED'] },
      },
    });
    if (blocked)
      throw new GiftCardOperationError(
        'Un envoi est déjà en cours ou son résultat est incertain. Vérifiez-le avant de renvoyer la carte.',
      );
    const row = await enqueueGiftCardDelivery(tx, {
      restaurantId: card.restaurantId,
      giftCardId: card.id,
      kind,
      generation: input.idempotencyKey,
    });
    await tx.reservationAuditLog.create({
      data: {
        actor: input.actor,
        event: 'gift_card_delivery_requested',
        metadata: {
          giftCardId: card.id,
          deliveryId: row.id,
          restaurantId: card.restaurantId,
          channel: input.channel,
        },
      },
    });
    return { id: row.id, status: row.status };
  }, DEFAULT_TRANSACTION_OPTIONS);
}

export async function resolveGiftCardDelivery(
  prisma: PrismaClient,
  input: {
    restaurantId: string;
    giftCardId: string;
    deliveryId: string;
    resolution: 'accepted' | 'not_accepted';
    providerCaseReference: string;
    actor: string;
  },
) {
  return prisma.$transaction(async (tx) => {
    await lockGiftCard(tx, input.giftCardId);
    const row = await tx.giftCardDelivery.findFirst({
      where: {
        id: input.deliveryId,
        giftCardId: input.giftCardId,
        restaurantId: input.restaurantId,
      },
    });
    if (!row) throw new GiftCardOperationError('Envoi introuvable.', 404);
    const status = input.resolution === 'accepted' ? 'SENT' : 'FAILED';
    if (row.status === status) return { status };
    if (row.status !== 'UNKNOWN')
      throw new GiftCardOperationError('Seul un résultat incertain peut être résolu manuellement.');
    const changed = await tx.giftCardDelivery.updateMany({
      where: { id: row.id, restaurantId: input.restaurantId, status: 'UNKNOWN' },
      data: {
        status,
        lastErrorCode:
          input.resolution === 'accepted' ? 'MANUAL_ACCEPTANCE' : 'MANUAL_NON_ACCEPTANCE',
        sentAt: input.resolution === 'accepted' ? new Date() : null,
      },
    });
    if (!changed.count)
      throw new GiftCardOperationError('Le résultat a changé. Actualisez l’historique.');
    await tx.reservationAuditLog.create({
      data: {
        actor: input.actor,
        event: 'gift_card_delivery_resolved',
        metadata: {
          restaurantId: input.restaurantId,
          giftCardId: input.giftCardId,
          deliveryId: row.id,
          resolution: input.resolution,
          providerCaseReference: input.providerCaseReference,
        },
      },
    });
    return { status };
  }, DEFAULT_TRANSACTION_OPTIONS);
}
