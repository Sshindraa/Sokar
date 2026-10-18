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
 * - TELNYX_WHATSAPP_FROM : numéro WhatsApp dédié validé via embedded signup
 * - WHATSAPP_ENABLED : flag "true" pour activer WhatsApp (sinon fallback SMS)
 *
 * Setup côté Telnyx Mission Control :
 * 1. Messaging → WhatsApp → Get Started (embedded signup, 15 min)
 * 2. Sélectionner le numéro Telnyx existant comme WhatsApp sender
 * 3. Créer le template "reservation_reminder" (UTILITY, fr)
 * 4. Attendre approbation Meta (24-48h)
 * 5. Set WHATSAPP_ENABLED=true dans .env
 */

import {
  extractProviderMessageId,
  type NotificationProviderResult,
  type NotificationSendResult,
} from '../queue/notification-idempotency';
import { lookupTelnyxMessage } from '../telnyx/client';
import { isMetaWhatsAppConfigured, sendMetaWhatsAppTemplate } from './meta-client';
import {
  recordAcceptedMessagingUsage,
  type MessagingUsageContext,
} from '../../modules/usage/messaging-usage.service';

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

// Résolu une fois au boot du module, pas à chaque sendReminder.
const WHATSAPP_ENABLED = process.env.WHATSAPP_ENABLED === 'true';

export function isWhatsAppConfigured(): boolean {
  if (getWhatsAppProvider() === 'meta') return WHATSAPP_ENABLED && isMetaWhatsAppConfigured();
  if (process.env.WHATSAPP_PROVIDER && process.env.WHATSAPP_PROVIDER !== 'telnyx') return false;
  return (
    WHATSAPP_ENABLED && Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_WHATSAPP_FROM)
  );
}

export function getWhatsAppProvider(): 'meta' | 'telnyx' {
  return process.env.WHATSAPP_PROVIDER === 'meta' ? 'meta' : 'telnyx';
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
  usage?: MessagingUsageContext,
): Promise<void | NotificationSendResult> {
  if (getWhatsAppProvider() === 'meta') {
    return sendMetaWhatsAppTemplate(to, templateName, languageCode, params, usage);
  }
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_WHATSAPP_FROM;
  if (!key || !from) throw new Error('WhatsApp sender and API key are required');
  const payload: TelnyxWhatsappTemplateMessage = {
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
  };
  // The installed Telnyx v2 SDK has no sendWhatsapp method. Never retry an
  // ambiguous HTTP request here: the reminder claims own reconciliation.
  const response = await fetch('https://api.telnyx.com/v2/messages/whatsapp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) {
    // Do not propagate provider bodies: they can contain recipient data.
    throw Object.assign(new Error('WhatsApp provider request failed'), {
      statusCode: response.status,
    });
  }
  const providerMessageId = extractProviderMessageId(await response.json());
  const result: NotificationSendResult = {
    outcome: providerMessageId ? 'success' : 'unknown',
    provider: 'telnyx',
    channel: 'whatsapp',
    ...(providerMessageId ? { providerMessageId } : {}),
  };
  if (usage && result.outcome === 'success') {
    await recordAcceptedMessagingUsage({
      channel: 'whatsapp',
      provider: 'telnyx',
      providerMessageId: result.providerMessageId,
      context: usage,
    });
  }
  return result;
}

/** Telnyx exposes the same message status endpoint for SMS and WhatsApp. */
export async function lookupWhatsAppMessage(
  providerMessageId: string,
  provider: 'meta' | 'telnyx' = getWhatsAppProvider(),
): Promise<NotificationProviderResult> {
  // Cloud API has no equivalent of Telnyx's GET message status endpoint.
  // Keep ambiguous sends blocked for manual review, never query Telnyx for them.
  if (provider === 'meta') return 'unknown';
  return lookupTelnyxMessage(providerMessageId);
}
