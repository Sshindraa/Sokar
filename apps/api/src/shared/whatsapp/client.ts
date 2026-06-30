/**
 * WhatsApp Business Cloud API client (direct Meta, pas de provider intermédiaire).
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 *
 * Prérequis (.env) :
 * - WHATSAPP_ACCESS_TOKEN : token permanent Meta
 * - WHATSAPP_PHONE_NUMBER_ID : ID du numéro WhatsApp Business
 * - WHATSAPP_BUSINESS_ACCOUNT_ID : WABA ID (pour webhook verification)
 * - WHATSAPP_VERIFY_TOKEN : token arbitraire pour vérifier le webhook inbound
 *
 * Si ces vars ne sont pas set, isWhatsAppConfigured() retourne false
 * et le système fallback sur SMS automatiquement.
 */

const WHATSAPP_API_BASE = 'https://graph.facebook.com/v21.0';

export function isWhatsAppConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Envoie un message template (utility) à un client.
 *
 * Les templates doivent être approuvés par Meta avant utilisation.
 * Pour Sokar, le template "reservation_reminder" est en catégorie UTILITY.
 *
 * @param to Numéro du client au format international (ex: +33612345678)
 * @param templateName Nom du template approuvé par Meta (ex: "reservation_reminder")
 * @param languageCode Code langue (ex: "fr")
 * @param components Variables du template au format WhatsApp Cloud API
 */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  languageCode: string,
  components: Array<{
    type: 'body';
    parameters: Array<{ type: 'text'; text: string }>;
  }>,
): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error(
      'WhatsApp not configured: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID',
    );
  }

  // WhatsApp exige le numéro sans le "+" initial
  const normalizedTo = to.replace(/^\+/, '');

  const body = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      components,
    },
  };

  const res = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${errText}`);
  }
}

/**
 * Envoie un message texte simple (free-form) à un client.
 *
 * Uniquement possible dans la fenêtre de service de 24h après que le client
 * a envoyé un message. Hors de cette fenêtre, il faut utiliser un template.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function _sendWhatsAppText(to: string, text: string): Promise<void> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    throw new Error(
      'WhatsApp not configured: missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID',
    );
  }

  const normalizedTo = to.replace(/^\+/, '');

  const body = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'text',
    text: { body: text },
  };

  const res = await fetch(`${WHATSAPP_API_BASE}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WhatsApp API error ${res.status}: ${errText}`);
  }
}
