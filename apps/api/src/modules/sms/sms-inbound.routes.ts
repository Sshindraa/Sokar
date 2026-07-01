import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard } from '../voice/telnyx.guard';
import { handleReply } from './reply-handler';

interface TelnyxFromObject {
  phone_number?: string;
}

interface TelnyxMessagePayload {
  from?: string | TelnyxFromObject;
  text?: string;
}

interface TelnyxWebhookBody {
  data?: {
    event_type?: string;
    payload?: TelnyxMessagePayload;
  };
}

/**
 * Handler pour les SMS entrants de Telnyx (réponses clients).
 *
 * Délègue le parsing OUI/NON et la logique métier à reply-handler.ts,
 * partagé avec le webhook WhatsApp inbound.
 */

export async function smsInboundRoutes(app: FastifyInstance) {
  app.post('/sms/telnyx/inbound', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const body = req.body as TelnyxWebhookBody;
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (eventType !== 'message.received') {
      return reply.send({ result: 'ignored' });
    }

    // Telnyx SMS: from est un objet avec phone_number
    const fromObj = payload?.from;
    const from = typeof fromObj === 'string' ? fromObj : fromObj?.phone_number;
    const text = payload?.text;

    if (!from || !text) {
      req.log.warn({ from, hasText: !!text }, 'sms inbound: missing from or text');
      return reply.send({ result: 'ok' });
    }

    req.log.info({ from, textLength: text.length }, 'sms inbound received');

    await handleReply(from, text, 'sms');

    return reply.send({ result: 'ok' });
  });
}
