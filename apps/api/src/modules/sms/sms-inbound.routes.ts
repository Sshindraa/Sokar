import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard } from '../voice/telnyx.guard';
import { handleReply } from './reply-handler';

/**
 * Handler pour les SMS entrants de Telnyx (réponses clients).
 *
 * Délègue le parsing OUI/NON et la logique métier à reply-handler.ts,
 * partagé avec le webhook WhatsApp inbound.
 */

export async function smsInboundRoutes(app: FastifyInstance) {
  app.post('/sms/telnyx/inbound', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body = req.body as any;
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (eventType !== 'message.received') {
      return reply.send({ result: 'ignored' });
    }

    // Telnyx SMS: from est un objet avec phone_number
    const from = payload?.from?.phone_number ?? payload?.from;
    const text = payload?.text;

    if (!from || !text) {
      req.log.warn({ from, hasText: !!text }, 'sms inbound: missing from or text');
      return reply.send({ result: 'ok' });
    }

    req.log.info({ from, textLength: text?.length }, 'sms inbound received');

    await handleReply(from, text, 'sms');

    return reply.send({ result: 'ok' });
  });
}
