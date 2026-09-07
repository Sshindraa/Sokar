import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { telnyxWebhookGuard } from '../voice/telnyx.guard';
import { handleReply } from './reply-handler';
import { telnyxMessagingEventsTotal } from '../../shared/observability/metrics';

const TelnyxFromSchema = z.union([z.string(), z.object({ phone_number: z.string() })]);
const TelnyxRecipientSchema = z.object({
  phone_number: z.string().optional(),
  status: z.string().optional(),
});

const TelnyxWebhookPayloadSchema = z.object({
  id: z.string().optional(),
  from: TelnyxFromSchema.optional(),
  text: z.string().optional(),
  to: z.array(TelnyxRecipientSchema).optional(),
  errors: z.array(z.unknown()).optional(),
});

const TelnyxWebhookBodySchema = z.object({
  data: z.object({
    event_type: z.string(),
    payload: TelnyxWebhookPayloadSchema,
  }),
});

type MessagingStatus =
  | 'received'
  | 'sent'
  | 'delivered'
  | 'delivery_failed'
  | 'delivery_unconfirmed'
  | 'unknown';

function normalizeMessagingStatus(eventType: string, status?: string): MessagingStatus {
  if (eventType === 'message.received') return 'received';
  if (eventType === 'message.sent') return 'sent';
  switch (status) {
    case 'delivered':
      return 'delivered';
    case 'delivery_unconfirmed':
    case 'dlr_timeout':
      return 'delivery_unconfirmed';
    case 'delivery_failed':
    case 'sending_failed':
    case 'failed':
    case 'gw_timeout':
      return 'delivery_failed';
    case 'sent':
      return 'sent';
    default:
      return 'unknown';
  }
}

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
    const firstRecipient = data.payload.to?.[0];
    const status = normalizeMessagingStatus(data.event_type, firstRecipient?.status);
    if (
      data.event_type === 'message.received' ||
      data.event_type === 'message.sent' ||
      data.event_type === 'message.finalized'
    ) {
      telnyxMessagingEventsTotal.inc({
        event: data.event_type.replace('message.', ''),
        status,
      });
    }

    if (data.event_type !== 'message.received') {
      if (data.event_type === 'message.finalized' && status === 'delivery_failed') {
        req.log.warn(
          { messageId: data.payload.id, status, errorCount: data.payload.errors?.length ?? 0 },
          'Telnyx SMS delivery failed',
        );
      } else if (data.event_type === 'message.finalized' && status === 'delivered') {
        req.log.info({ messageId: data.payload.id, status }, 'Telnyx SMS delivered');
      } else if (data.event_type === 'message.sent') {
        req.log.info({ messageId: data.payload.id, status }, 'Telnyx SMS accepted by carrier');
      }
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
