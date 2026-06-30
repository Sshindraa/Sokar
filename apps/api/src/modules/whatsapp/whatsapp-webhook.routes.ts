import { FastifyInstance } from 'fastify';

/**
 * Webhook Telnyx messaging — gère les messages entrants SMS ET WhatsApp.
 *
 * Telnyx envoie tous les messages entrants au même format :
 * { data: { event_type: "message.received", payload: { text, from, type, ... } } }
 *
 * Le champ payload.type distingue SMS ("SMS"/"MMS") de WhatsApp ("whatsapp").
 *
 * Configuration côté Telnyx Mission Control :
 * - Messaging → Profiles → ton profile → Webhooks → Add URL
 * - URL: https://api.sokar.tech/whatsapp/webhook
 * - Events: message.received
 *
 * Pas de verify token comme Meta — Telnyx utilise un webhook secret signé
 * dans le header `telnyx-signature-ed25519` (optionnel, déjà géré par le
 * middleware Telnyx webhook si configuré).
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

    // Telnyx WhatsApp: from est une string, SMS: from est un objet avec phone_number
    const from = typeof payload.from === 'string' ? payload.from : payload.from?.phone_number;
    const text = payload.text;
    const messageType = payload.type; // "SMS", "MMS", "whatsapp"

    req.log.info(
      { from, messageType, textLength: text?.length },
      '[whatsapp] inbound message received',
    );

    if (text) {
      // Le client a répondu — fenêtre de service 24h ouverte pour WhatsApp
      // Le handler SMS inbound existant gère déjà le parsing OUI/NON.
      // On log seulement pour l'instant — on pourrait étendre plus tard
      // pour parser les réponses WhatsApp comme on le fait pour les SMS.
      req.log.info({ from, text, messageType }, '[whatsapp] client reply received');
    }

    // Toujours retourner 200 rapidement — Telnyx retry si pas de 200
    return reply.send({ result: 'ok' });
  });
}
