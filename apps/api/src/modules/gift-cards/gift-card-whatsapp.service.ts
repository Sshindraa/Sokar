import type { NotificationSendResult } from '../../shared/queue/notification-idempotency';
/**
 * Gift card WhatsApp service — envoi de la carte cadeau au destinataire via WhatsApp.
 *
 * Utilise la fonction sendWhatsApp du client Telnyx (shared/telnyx/client.ts).
 */
import { giftCardBeneficiaryUrl } from './gift-card-links.util';
import { sendWhatsApp } from '../../shared/telnyx/client';
import { logger } from '../../shared/logger/pino';
import type { MessagingUsageContext } from '../usage/messaging-usage.service';

type SendWhatsAppInput = {
  to: string;
  restaurantId?: string;
  accountId?: string | null;
  giftCardId?: string;
  code: string;
  amount: number;
  restaurantName: string;
};

/**
 * Envoie un message WhatsApp texte simple au destinataire avec le code cadeau.
 *
 * Le numéro doit être au format international (E.164).
 * Les erreurs sont laissées remonter à l'appelant (Promise.allSettled dans
 * gift-card-payment.service.ts) — pas de .catch() interne.
 */
export async function sendRecipientWhatsApp(
  input: SendWhatsAppInput,
): Promise<void | NotificationSendResult> {
  if (!input.to) {
    logger.warn('[gift-card-whatsapp] sendRecipientWhatsApp: no recipient phone, skipping');
    return;
  }

  const text = `🎁 Vous avez reçu une carte cadeau de ${input.amount}€ chez ${input.restaurantName} !\n\nVotre code : ${input.code}\n\nPrésentez-le au restaurant pour régler votre addition. ${giftCardBeneficiaryUrl(input.code) ?? ''}`;

  const usage: MessagingUsageContext | undefined =
    input.restaurantId && input.giftCardId
      ? {
          restaurantId: input.restaurantId,
          accountId: input.accountId,
          sourceType: 'gift_card_whatsapp_delivery',
          sourceId: input.giftCardId,
          metadata: { messageType: 'gift_card_whatsapp_delivery' },
        }
      : undefined;

  const result = await sendWhatsApp(input.to, text, usage);

  logger.info(
    { giftCardId: input.giftCardId, amount: input.amount },
    '[gift-card-whatsapp] WhatsApp sent to recipient',
  );
  return result;
}
