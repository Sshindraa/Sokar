import { FastifyInstance } from 'fastify';
import { handleReply } from '../sms/reply-handler';

/**
 * Webhook Telnyx messaging — gère les messages entrants WhatsApp.
 *
 * Telnyx envoie tous les messages entrants au même format :
 * { data: { event_type: "message.received", payload: { text, from, type, ... } } }
 *
 * Le parsing OUI/NON est partagé avec le webhook SMS via reply-handler.ts.
 * Un client qui répond "NON" sur WhatsApp annule sa résa, exactement comme SMS.
 *
 * Configuration côté Telnyx Mission Control :
 * - Messaging → Profiles → ton profile → Webhooks → Add URL
 * - URL: https://api.sokar.tech/whatsapp/webhook
 * - Events: message.received
 */

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.post('/whatsapp/webhook', async (req, reply) => {
    const body = req.body as any;
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (eventType !== 'message.received' || !payload) {
      // Notification de statut (sent, delivered, etc.) — on ignore
      return reply.send({ result: 'ok' });
    }

    // Telnyx WhatsApp: from est une string (E.164)
    const from = typeof payload.from === 'string' ? payload.from : payload.from?.phone_number;
    const text = payload.text;

    if (!from || !text) {
      req.log.warn({ from, hasText: !!text }, 'whatsapp inbound: missing from or text');
      return reply.send({ result: 'ok' });
    }

    req.log.info({ from, textLength: text?.length }, 'whatsapp inbound received');

    // Même handler que SMS — parse OUI/NON et agit sur la résa
    await handleReply(from, text, 'whatsapp');

    return reply.send({ result: 'ok' });
  });
}
