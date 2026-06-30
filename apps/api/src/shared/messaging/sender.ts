/**
 * Abstraction multi-canal pour l'envoi de messages.
 *
 * Stratégie :
 * - Rappel J-1 (utility) → WhatsApp si configuré, sinon SMS
 * - Réactivation VIP (marketing) → toujours SMS (WhatsApp marketing coûte 5x plus cher + opt-in requis)
 * - Messages transactionnels (annulation, etc.) → WhatsApp si configuré, sinon SMS
 *
 * Le fallback SMS est automatique si WhatsApp n'est pas configuré ou si l'envoi échoue.
 * Chaque envoi émet un event analytics `reminder_sent` avec le canal pour comparer
 * open rate SMS vs WhatsApp et justifier l'économie.
 */

import { sendSms } from '../telnyx/client';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '../whatsapp/client';
import { trackMessagingEvent } from '../../modules/analytics/events.service';
import { logger } from '../logger/pino';

export type MessageChannel = 'whatsapp' | 'sms';

export interface SendReminderParams {
  to: string;
  restaurantName: string;
  restaurantId?: string;
  reservationId?: string;
  customerId?: string;
  date: string; // déjà formaté en français
  time: string;
  partySize: number;
}

export interface SendResult {
  channel: MessageChannel;
  success: boolean;
  error?: string;
}

/**
 * Envoie un rappel de réservation J-1.
 * WhatsApp (utility template) si configuré, sinon SMS.
 */
export async function sendReminder(params: SendReminderParams): Promise<SendResult> {
  const { to, restaurantName, restaurantId, reservationId, customerId, date, time, partySize } =
    params;

  if (isWhatsAppConfigured()) {
    try {
      await sendWhatsAppTemplate(to, 'reservation_reminder', 'fr', [
        restaurantName,
        date,
        time,
        String(partySize),
      ]);
      const result: SendResult = { channel: 'whatsapp', success: true };
      await trackMessagingEvent({
        event: 'reminder_sent',
        channel: 'whatsapp',
        restaurantId,
        reservationId,
        customerId,
        success: true,
      });
      return result;
    } catch (err: any) {
      // Fallback SMS si WhatsApp échoue
      logger.warn(
        { err: err.message, reservationId, restaurantId },
        '[messaging] WhatsApp failed, falling back to SMS',
      );
      await trackMessagingEvent({
        event: 'whatsapp_fallback_to_sms',
        channel: 'whatsapp',
        restaurantId,
        reservationId,
        customerId,
        success: false,
        error: err.message,
      });
    }
  }

  // SMS fallback (ou canal par défaut si WhatsApp non configuré)
  try {
    const smsText = `Rappel ${restaurantName}: votre réservation ${date} à ${time} pour ${partySize} pers. Nous avons hâte de vous accueillir.`;
    await sendSms(to, smsText);
    const result: SendResult = { channel: 'sms', success: true };
    await trackMessagingEvent({
      event: 'reminder_sent',
      channel: 'sms',
      restaurantId,
      reservationId,
      customerId,
      success: true,
    });
    return result;
  } catch (err: any) {
    await trackMessagingEvent({
      event: 'reminder_sent',
      channel: 'sms',
      restaurantId,
      reservationId,
      customerId,
      success: false,
      error: err.message,
    });
    return { channel: 'sms', success: false, error: err.message };
  }
}

/**
 * Envoie un SMS de réactivation VIP.
 * Toujours SMS — WhatsApp marketing coûte 5x plus cher et nécessite un opt-in.
 */
export async function sendReactivation(
  to: string,
  restaurantName: string,
  customerName: string,
  restaurantPhone: string,
): Promise<SendResult> {
  const firstName = customerName.split(' ')[0] || customerName;
  const text = `Bonjour ${firstName}, cela fait un moment qu'on ne vous a pas vu chez ${restaurantName}. On serait ravis de vous revoir ! Réservez au ${restaurantPhone}.`;

  try {
    await sendSms(to, text);
    return { channel: 'sms', success: true };
  } catch (err: any) {
    return { channel: 'sms', success: false, error: err.message };
  }
}
