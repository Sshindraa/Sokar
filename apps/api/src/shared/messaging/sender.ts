/**
 * Abstraction multi-canal pour l'envoi de messages.
 *
 * Stratégie :
 * - Rappel J-1 (utility) → WhatsApp si configuré, sinon SMS
 * - Réactivation VIP (marketing) → toujours SMS (WhatsApp marketing coûte 5x plus cher + opt-in requis)
 * - Messages transactionnels (annulation, etc.) → WhatsApp si configuré, sinon SMS
 *
 * Le fallback SMS est automatique si WhatsApp n'est pas configuré ou si l'envoi échoue.
 */

import { sendSms } from '../telnyx/client';
import { isWhatsAppConfigured, sendWhatsAppTemplate } from '../whatsapp/client';

export type MessageChannel = 'whatsapp' | 'sms';
export type MessagePurpose = 'utility' | 'marketing';

export interface SendReminderParams {
  to: string;
  restaurantName: string;
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
  const { to, restaurantName, date, time, partySize } = params;

  if (isWhatsAppConfigured()) {
    try {
      await sendWhatsAppTemplate(to, 'reservation_reminder', 'fr', [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: restaurantName },
            { type: 'text', text: date },
            { type: 'text', text: time },
            { type: 'text', text: String(partySize) },
          ],
        },
      ]);
      return { channel: 'whatsapp', success: true };
    } catch (err: any) {
      // Fallback SMS si WhatsApp échoue
      console.warn(`[messaging] WhatsApp failed, falling back to SMS: ${err.message}`);
    }
  }

  // SMS fallback
  try {
    const smsText = `Rappel ${restaurantName}: votre réservation ${date} à ${time} pour ${partySize} pers. Nous avons hâte de vous accueillir.`;
    await sendSms(to, smsText);
    return { channel: 'sms', success: true };
  } catch (err: any) {
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
