/**
 * WhatsApp Business messaging via Telnyx BSP.
 *
 * Telnyx est BSP WhatsApp officiel — l'embedded signup gère le Meta Business
 * Manager de bout en bout. On utilise la même API key Telnyx que pour les SMS.
 *
 * Docs: https://developers.telnyx.com/docs/messaging/whatsapp/send-messages
 * Endpoint: POST https://api.telnyx.com/v2/messages/whatsapp
 *
 * Prérequis (.env) :
 * - TELNYX_API_KEY : déjà présent (utilisé pour SMS + voice)
 * - TELNYX_FROM_NUMBER : déjà présent (numéro WhatsApp-enabled via embedded signup)
 * - WHATSAPP_ENABLED : flag "true" pour activer WhatsApp (sinon fallback SMS)
 *
 * Setup côté Telnyx Mission Control :
 * 1. Messaging → WhatsApp → Get Started (embedded signup, 15 min)
 * 2. Sélectionner le numéro Telnyx existant comme WhatsApp sender
 * 3. Créer le template "reservation_reminder" (UTILITY, fr)
 * 4. Attendre approbation Meta (24-48h)
 * 5. Set WHATSAPP_ENABLED=true dans .env
 */

const createTelnyx: (key: string) => TelnyxClient = require('telnyx');

interface TelnyxWhatsappTemplateMessage {
  from: string;
  to: string;
  whatsapp_message: {
    type: 'template';
    template: {
      name: string;
      language: { policy: 'deterministic'; code: string };
      components: Array<{
        type: 'body';
        parameters: Array<{ type: 'text'; text: string }>;
      }>;
    };
  };
}

interface TelnyxClient {
  messages: {
    sendWhatsapp: (payload: TelnyxWhatsappTemplateMessage) => Promise<unknown>;
  };
}

let _telnyx: TelnyxClient | null = null;

function getTelnyx(): TelnyxClient {
  if (!_telnyx) {
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY is required');
    }
    _telnyx = createTelnyx(process.env.TELNYX_API_KEY);
  }
  return _telnyx;
}

// Résolu une fois au boot du module, pas à chaque sendReminder.
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';

export function isWhatsAppConfigured(): boolean {
  return WHATSAPP_ENABLED && Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER);
}

/**
 * Envoie un message template (utility) via Telnyx WhatsApp API.
 *
 * @param to Numéro du client (E.164, ex: +33612345678)
 * @param templateName Nom du template approuvé (ex: "reservation_reminder")
 * @param languageCode Code langue (ex: "fr")
 * @param params Variables du template dans l'ordre ({{1}}, {{2}}, ...)
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  params: string[],
): Promise<void> {
  const t = getTelnyx();
  const from = process.env.TELNYX_FROM_NUMBER!;

  await t.messages.sendWhatsapp({
    from,
    to,
    whatsapp_message: {
      type: 'template',
      template: {
        name: templateName,
        language: {
          policy: 'deterministic',
          code: languageCode,
        },
        components: [
          {
            type: 'body',
            parameters: params.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    },
  });
}
