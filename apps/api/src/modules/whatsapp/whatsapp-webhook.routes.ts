import { createHash } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { telnyxWebhookGuard } from '../voice/telnyx.guard';
import { RATE_LIMIT_PROVIDER_WEBHOOK } from '../../plugins/rate-limit.policy';
import { applyMarketingProviderEvent } from '../marketing/marketing-provider.service';
import { queueInboundReplyReview } from '../sms/inbound-review';

interface TelnyxFromObject {
  phone_number?: string;
}

const webhookRouteOptions = {
  preHandler: telnyxWebhookGuard,
  config: { rateLimit: RATE_LIMIT_PROVIDER_WEBHOOK },
};

interface TelnyxMessagePayload {
  id?: string;
  from?: string | TelnyxFromObject;
  text?: string;
  to?: Array<{ status?: string }>;
}

interface TelnyxWebhookBody {
  data?: {
    event_type?: string;
    payload?: TelnyxMessagePayload;
  };
}

/**
 * Webhook Telnyx messaging — gère les messages entrants WhatsApp.
 *
 * Telnyx envoie tous les messages entrants au même format :
 * { data: { event_type: "message.received", payload: { text, from, type, ... } } }
 *
 * Les réponses sont suspendues tant que leur réservation ne peut pas être identifiée.
 *
 * Configuration côté Telnyx Mission Control :
 * - Messaging → Profiles → ton profile → Webhooks → Add URL
 * - URL: https://api.sokar.tech/whatsapp/webhook
 * - Events: message.received
 */

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  app.post('/whatsapp/webhook', webhookRouteOptions, async (req, reply) => {
    const body = req.body as TelnyxWebhookBody;
    const eventType = body?.data?.event_type;
    const payload = body?.data?.payload;

    if (eventType !== 'message.received') {
      if (payload?.id) {
        await applyMarketingProviderEvent({
          provider: 'telnyx',
          providerMessageId: payload.id,
          eventType: eventType ?? '',
          providerStatus: payload.to?.[0]?.status,
          errorCode: eventType,
          payloadHash:
            typeof req.rawBody === 'string'
              ? createHash('sha256').update(req.rawBody).digest('hex')
              : undefined,
        });
      }
      // Notification de statut (sent, delivered, etc.) — on accuse réception
      // après avoir réconcilié une éventuelle CampaignMessage.
      return reply.send({ result: 'ok' });
    }

    if (!payload) return reply.send({ result: 'ok' });

    // Telnyx WhatsApp: from est une string (E.164)
    const fromObj = payload.from;
    const from = typeof fromObj === 'string' ? fromObj : fromObj?.phone_number;
    const text = payload.text;

    if (!payload.id) {
      req.log.warn('whatsapp inbound: missing message ID');
      return reply.status(503).send({ result: 'temporarily_unavailable' });
    }
    if (!from || !text) {
      req.log.warn(
        { hasFrom: Boolean(from), hasText: !!text, hasId: Boolean(payload.id) },
        'whatsapp inbound: missing from, text or message ID',
      );
      return reply.send({ result: 'ok' });
    }

    req.log.info({ hasFrom: true, textLength: text.length }, 'whatsapp inbound received');

    // A shared sender cannot identify the reservation; retain an opaque reference for review.
    try {
      await queueInboundReplyReview('whatsapp', payload.id);
    } catch {
      req.log.error('whatsapp inbound: review queue unavailable');
      return reply.status(503).send({ result: 'temporarily_unavailable' });
    }
    return reply.send({ result: 'ok' });
  });
}
