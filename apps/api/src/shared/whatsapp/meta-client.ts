import type { NotificationSendResult } from '../queue/notification-idempotency';
import {
  recordAcceptedMessagingUsage,
  type MessagingUsageContext,
} from '../../modules/usage/messaging-usage.service';

export function isMetaWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.META_WHATSAPP_ACCESS_TOKEN &&
    /^\d+$/.test(process.env.META_WHATSAPP_PHONE_NUMBER_ID ?? '') &&
    /^v\d+\.\d+$/.test(process.env.META_WHATSAPP_GRAPH_VERSION ?? ''),
  );
}

export async function sendMetaWhatsAppTemplate(
  to: string,
  name: string,
  language: string,
  params: string[],
  usage?: MessagingUsageContext,
): Promise<NotificationSendResult> {
  if (!isMetaWhatsAppConfigured()) throw new Error('Meta WhatsApp is not configured');
  const response = await fetch(
    `https://graph.facebook.com/${process.env.META_WHATSAPP_GRAPH_VERSION}/${process.env.META_WHATSAPP_PHONE_NUMBER_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.META_WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name,
          language: { code: language },
          components: [
            { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
          ],
        },
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    },
  );
  if (!response.ok) {
    throw Object.assign(new Error('Meta WhatsApp request failed'), { statusCode: response.status });
  }
  // No retry here: a timeout or malformed receipt can hide provider acceptance.
  const body = (await response.json()) as { messages?: Array<{ id?: unknown }> };
  const id = body.messages?.[0]?.id;
  const providerMessageId = typeof id === 'string' ? id.trim() || undefined : undefined;
  const result: NotificationSendResult = {
    provider: 'meta',
    channel: 'whatsapp',
    outcome: providerMessageId ? 'success' : 'unknown',
    ...(providerMessageId ? { providerMessageId } : {}),
  };
  if (usage && result.outcome === 'success') {
    await recordAcceptedMessagingUsage({
      channel: 'whatsapp',
      provider: 'meta',
      providerMessageId,
      context: usage,
    });
  }
  return result;
}
