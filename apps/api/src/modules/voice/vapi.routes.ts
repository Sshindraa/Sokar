/**
 * Routes Fastify pour les webhooks Vapi
 * Endpoint: POST /webhooks/vapi
 *
 * Usage Sprint 1/2 : tester Vapi en parallèle de Telnyx
 * https://docs.vapi.ai/webhooks
 */
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  handleAssistantRequest,
  handleFunctionCall,
  handleEndOfCallReport,
  verifyVapiWebhook,
} from './vapi.service';
import {
  VapiWebhookPayload,
  VapiFunctionCallPayload,
  VapiEndOfCallReport,
  VapiAssistantRequestPayload,
} from './vapi.types';

export default async function vapiRoutes(fastify: FastifyInstance) {
  /**
   * POST /webhooks/vapi
   * Point d'entrée unique pour tous les webhooks Vapi
   * Configure ce URL dans ton dashboard Vapi → Assistant → Server URL
   */
  fastify.post('/webhooks/vapi', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      // Vérification basique (optionnel en dev)
      if (!verifyVapiWebhook(req)) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const payload = req.body as VapiWebhookPayload;
      const messageType = payload.message?.type;

      fastify.log.info(`[Vapi] Webhook received: ${messageType}`);

      switch (messageType) {
        case 'assistant-request': {
          const result = await handleAssistantRequest(payload as unknown as VapiAssistantRequestPayload);
          return reply.status(200).send(result);
        }

        case 'function-call': {
          const result = await handleFunctionCall(payload as unknown as VapiFunctionCallPayload);
          return reply.status(200).send(result);
        }

        case 'end-of-call-report': {
          await handleEndOfCallReport(payload as unknown as VapiEndOfCallReport);
          return reply.status(200).send({ status: 'logged' });
        }

        case 'status-update': {
          fastify.log.info(`[Vapi] Call status: ${payload.message.call.status}`);
          return reply.status(200).send({ status: 'acknowledged' });
        }

        case 'conversation-update':
        case 'model-output':
        case 'transcript': {
          // Log silencieux pour debug
          fastify.log.debug(`[Vapi] ${messageType} received for call ${payload.message.call.id}`);
          return reply.status(200).send({ status: 'acknowledged' });
        }

        default:
          fastify.log.warn(`[Vapi] Unknown webhook type: ${messageType}`);
          return reply.status(200).send({ status: 'unknown_type' });
      }
    } catch (err) {
      fastify.log.error(err);
      return reply.status(500).send({ error: 'Internal error', message: (err as Error).message });
    }
  });

  /**
   * GET /health/vapi
   * Vérification rapide que l'intégration Vapi est configurée
   */
  fastify.get('/health/vapi', async (_req, reply) => {
    const configured = !!process.env.VAPI_API_KEY;
    return reply.status(200).send({
      status: configured ? 'configured' : 'missing_api_key',
      provider: 'vapi',
      webhookUrl: `${process.env.PUBLIC_URL}/webhooks/vapi`,
      creditsRemaining: 'check-dashboard', // Vapi dashboard pour les crédits
    });
  });
}
