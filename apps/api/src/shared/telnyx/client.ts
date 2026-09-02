const createTelnyx: (key: string) => import('telnyx').TelnyxClient = require('telnyx');
import * as https from 'https';
import {
  extractProviderMessageId,
  type NotificationProviderResult,
  type NotificationSendResult,
} from '../queue/notification-idempotency';

// Agent keep-alive persistant pour le SDK Telnyx (balance, SMS, WhatsApp, outbound calls).
// Évite le handshake TLS (~113ms) à chaque appel en réutilisant la connexion.
const telnyxHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 20,
  maxFreeSockets: 10,
  timeout: 60_000,
});

type TelnyxClient = import('telnyx').TelnyxClient;

let _telnyx: TelnyxClient | null = null;

function getTelnyx(): TelnyxClient {
  if (!_telnyx) {
    if (!process.env.TELNYX_API_KEY) {
      throw new Error('TELNYX_API_KEY is required');
    }
    _telnyx = createTelnyx(process.env.TELNYX_API_KEY);
    (_telnyx as unknown as { setHttpAgent: (a: https.Agent) => void }).setHttpAgent(
      telnyxHttpsAgent,
    );
  }
  return _telnyx;
}

const telnyx = new Proxy({} as TelnyxClient, {
  get(_, prop: string | symbol) {
    return (getTelnyx() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default telnyx;

export async function sendSms(to: string, text: string): Promise<void | NotificationSendResult> {
  const t = getTelnyx();
  const response = await t.messages.create({
    from: process.env.TELNYX_FROM_NUMBER!,
    to,
    text,
  });
  return normalizeTelnyxSendResponse(response, 'sms');
}

/**
 * Envoie un message WhatsApp texte simple via Telnyx Messaging API.
 *
 * Utilise le même endpoint messages.create que sendSms, avec type: 'whatsapp'
 * pour forcer le routage via WhatsApp Business (au lieu de SMS).
 *
 * Le numéro `from` doit être WhatsApp-enabled (embedded signup Telnyx).
 * Si TELNYX_WHATSAPP_FROM n'est pas défini, on fallback sur TELNYX_FROM_NUMBER.
 *
 * @param to  Numéro du destinataire (E.164, ex: +33612345678)
 * @param text Contenu du message texte
 */
export async function sendWhatsApp(
  to: string,
  text: string,
): Promise<void | NotificationSendResult> {
  const t = getTelnyx();
  const from = process.env.TELNYX_WHATSAPP_FROM ?? process.env.TELNYX_FROM_NUMBER;
  if (!from) {
    throw new Error('TELNYX_WHATSAPP_FROM or TELNYX_FROM_NUMBER is required for WhatsApp');
  }
  const response = await t.messages.create({
    from,
    to,
    text,
    // Le SDK Telnyx ne type pas `type` pour messages.create, mais l'API REST
    // accepte type: 'whatsapp' pour router via WhatsApp Business.
    ...({ type: 'whatsapp' } as Record<string, string>),
  });
  return normalizeTelnyxSendResponse(response, 'whatsapp');
}

type TelnyxMessageDeliveryStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'expired'
  | 'sending_failed'
  | 'delivery_unconfirmed'
  | 'delivered'
  | 'delivery_failed';

export function normalizeTelnyxSendResponse(
  response: unknown,
  channel: 'sms' | 'whatsapp' = 'sms',
): NotificationSendResult {
  const providerMessageId = extractProviderMessageId(response);
  return {
    outcome: 'success',
    provider: 'telnyx',
    channel,
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

function extractTelnyxMessageStatus(response: unknown): TelnyxMessageDeliveryStatus | undefined {
  const root =
    response && typeof response === 'object' ? (response as Record<string, unknown>) : null;
  const payload =
    root?.data && typeof root.data === 'object' ? (root.data as Record<string, unknown>) : root;
  const recipients = payload?.to;
  if (!Array.isArray(recipients) || !recipients[0] || typeof recipients[0] !== 'object') {
    return undefined;
  }
  const status = (recipients[0] as Record<string, unknown>).status;
  return typeof status === 'string' ? (status as TelnyxMessageDeliveryStatus) : undefined;
}

export function classifyTelnyxMessageResponse(response: unknown): NotificationProviderResult {
  const status = extractTelnyxMessageStatus(response);
  if (status === 'sending_failed' || status === 'expired') return 'failure_certain';
  if (
    status === 'queued' ||
    status === 'sending' ||
    status === 'sent' ||
    status === 'delivered' ||
    status === 'delivery_failed'
  ) {
    // The claim protects the accepted provider request, not final handset
    // delivery. A delivery failure must not trigger a blind duplicate.
    return 'success';
  }
  return 'unknown';
}

/**
 * Queries a Telnyx message without exposing the provider response to callers.
 * A retrieval error is deliberately unknown: a failed lookup is not proof
 * that the original message was not accepted.
 */
export async function lookupTelnyxMessage(
  providerMessageId: string,
): Promise<NotificationProviderResult> {
  try {
    const response = await getTelnyx().messages.retrieve(providerMessageId);
    return classifyTelnyxMessageResponse(response);
  } catch {
    return 'unknown';
  }
}

export interface OutboundCallOptions {
  webhookUrl: string;
  clientState?: Record<string, unknown>;
  connectionId?: string;
  timeoutSecs?: number;
}

export interface OutboundCallResult {
  callControlId: string;
}

export async function placeOutboundCall(
  to: string,
  options: OutboundCallOptions,
): Promise<OutboundCallResult> {
  const t = getTelnyx();
  const from = process.env.TELNYX_FROM_NUMBER;
  if (!from) {
    throw new Error('TELNYX_FROM_NUMBER is required for outbound calls');
  }

  const response = await t.calls.create({
    to,
    from,
    connection_id: options.connectionId,
    webhook_url: options.webhookUrl,
    webhook_url_method: 'POST',
    client_state: options.clientState
      ? Buffer.from(JSON.stringify(options.clientState)).toString('base64')
      : undefined,
    timeout: options.timeoutSecs ?? 30,
  });

  const callControlId = response?.data?.call_control_id ?? response?.call_control_id;
  if (!callControlId) {
    throw new Error('Telnyx outbound call: missing call_control_id in response');
  }
  return { callControlId };
}
