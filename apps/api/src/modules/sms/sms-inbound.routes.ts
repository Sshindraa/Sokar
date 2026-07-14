import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { telnyxWebhookGuard } from '../voice/telnyx.guard';
import { handleReply } from './reply-handler';

const TelnyxFromSchema = z.union([z.string(), z.object({ phone_number: z.string() })]);

const TelnyxWebhookPayloadSchema = z.object({
  from: TelnyxFromSchema.optional(),
  text: z.string().optional(),
});

const TelnyxWebhookBodySchema = z.object({
  data: z.object({
    event_type: z.string(),
    payload: TelnyxWebhookPayloadSchema,
  }),
});

/**
 * Handler pour les SMS entrants de Telnyx (réponses clients).
 *
 * Délègue le parsing OUI/NON et la logique métier à reply-handler.ts,
 * partagé avec le webhook WhatsApp inbound.
 */

export async function smsInboundRoutes(app: FastifyInstance) {
  app.post('/sms/telnyx/inbound', { preHandler: telnyxWebhookGuard }, async (req, reply) => {
    const parseResult = TelnyxWebhookBodySchema.safeParse(req.body);
    if (!parseResult.success) {
      req.log.warn({ errors: parseResult.error.errors }, 'sms inbound: invalid payload');
      return reply.status(400).send({ result: 'ignored' });
    }

    const { data } = parseResult.data;
    if (data.event_type !== 'message.received') {
      return reply.send({ result: 'ignored' });
    }

    // Telnyx SMS: from est un objet avec phone_number
    const fromObj = data.payload.from;
    const from = typeof fromObj === 'string' ? fromObj : fromObj?.phone_number;
    const text = data.payload.text;

    if (!from || !text) {
      req.log.warn({ from, hasText: !!text }, 'sms inbound: missing from or text');
      return reply.send({ result: 'ok' });
    }

    req.log.info({ from, textLength: text.length }, 'sms inbound received');

    await handleReply(from, text, 'sms');

    return reply.send({ result: 'ok' });
  });
}
