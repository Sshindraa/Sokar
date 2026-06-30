import { FastifyInstance } from 'fastify';

/**
 * Webhook WhatsApp Business Cloud API.
 *
 * Deux fonctions :
 * 1. GET /whatsapp/webhook — Vérification du webhook par Meta (challenge)
 * 2. POST /whatsapp/webhook — Réception des messages entrants des clients
 *
 * Le verify token est défini par WHATSAPP_VERIFY_TOKEN dans .env.
 * Meta envoie un GET avec hub.challenge qu'on doit retourner tel quel.
 */

export async function whatsappWebhookRoutes(app: FastifyInstance) {
  // Verification du webhook par Meta
  app.get('/whatsapp/webhook', async (req, reply) => {
    const query = req.query as {
      'hub.mode'?: string;
      'hub.challenge'?: string;
      'hub.verify_token'?: string;
    };

    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN
    ) {
      req.log.info('[whatsapp] webhook verified');
      // Meta attend le challenge en plain text
      return reply.type('text/plain').send(query['hub.challenge']);
    }

    req.log.warn('[whatsapp] webhook verification failed');
    return reply.status(403).send('Forbidden');
  });

  // Reception des messages entrants
  app.post('/whatsapp/webhook', async (req, reply) => {
    const body = req.body as any;

    // Meta envoie des notifications de statut aussi (sent, delivered, read)
    // On ignore tout sauf les messages texte entrants
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message) {
      // Notification de statut (delivered, read, etc.) — on ignore
      return reply.send({ result: 'ok' });
    }

    const from = message.from; // numéro du client sans "+"
    const text = message.text?.body;
    const messageType = message.type;

    req.log.info(
      { from, messageType, textLength: text?.length },
      '[whatsapp] inbound message received',
    );

    if (messageType === 'text' && text) {
      // Le client a répondu — on est dans la fenêtre de service 24h
      // On peut répondre en free-form sans template
      // Pour l'instant, on log seulement. Le handler SMS inbound existant
      // gère déjà le parsing OUI/NON. On pourrait étendre ça plus tard.
      req.log.info({ from, text }, '[whatsapp] client reply received');
    }

    // Toujours retourner 200 rapidement — Meta retry si pas de 200
    return reply.send({ result: 'ok' });
  });
}
