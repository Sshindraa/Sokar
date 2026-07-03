/**
 * Gift card WhatsApp service — envoi de la carte cadeau au destinataire via WhatsApp.
 *
 * Utilise le client Telnyx WhatsApp (message texte simple en P2).
 */
import telnyx from '../../shared/telnyx/client';
import { logger } from '../../shared/logger/pino';

type SendWhatsAppInput = {
  to: string;
  code: string;
  amount: number;
  restaurantName: string;
};

/**
 * Envoie un message WhatsApp texte simple au destinataire avec le code cadeau.
 *
 * En P2, on utilise l'API Telnyx WhatsApp Messaging (texte simple).
 * Le numéro doit être au format international (E.164).
 */
export async function sendRecipientWhatsApp(input: SendWhatsAppInput): Promise<void> {
  if (!input.to) {
    logger.warn('[gift-card-whatsapp] sendRecipientWhatsApp: no recipient phone, skipping');
    return;
  }

  const text = `🎁 Vous avez reçu une carte cadeau de ${input.amount}€ chez ${input.restaurantName} !\n\nVotre code : ${input.code}\n\nUtilisez-le lors de votre réservation.`;

  try {
    // Telnyx WhatsApp API — envoi texte simple
    await (
      telnyx as unknown as {
        messages: {
          create: (params: {
            from: string;
            to: string;
            text: string;
            messaging_profile_id?: string;
          }) => Promise<unknown>;
        };
      }
    ).messages.create({
      from: process.env.TELNYX_WHATSAPP_FROM ?? process.env.TELNYX_FROM_NUMBER!,
      to: input.to,
      text,
    });
    logger.info(
      { to: input.to, amount: input.amount },
      '[gift-card-whatsapp] WhatsApp sent to recipient',
    );
  } catch (err: unknown) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err), to: input.to },
      '[gift-card-whatsapp] Failed to send WhatsApp',
    );
    throw err;
  }
}
