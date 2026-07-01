/**
 * Routes OpenAI Reserve : business feed + tool restaurant_reservation.
 *
 * Spec : https://developers.openai.com/apps-sdk/guides/restaurant-reservation-conversion-spec
 *
 * Routes :
 *   GET  /v1/businesses           : feed paginé (filtre openaiReserveEnabled)
 *   POST /v1/tools/restaurant_reservation : tool Apps SDK conforme spec
 *
 * Auth : pas d'auth sur le feed (OpenAI l'ingère publiquement).
 * Le tool a un auth léger (API key ChatGPT Apps) — Phase 4 simplifié,
 * la vraie auth Apps SDK viendra quand on aura le partner access.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OpenaiReserveService } from './openai-reserve.service';
import { WIDGET_RESOURCE_URI, TOOL_NAME } from './constants';
import { FeedQuerySchema, RestaurantReservationInputSchema } from './schemas';
import { logger } from '../../../shared/logger/pino';
import { db } from '../../../shared/db/client';

export async function openaiReserveRoutes(app: FastifyInstance): Promise<void> {
  const service = new OpenaiReserveService(db);

  // GET /v1/businesses : business feed
  app.get('/v1/businesses', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = FeedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid query',
        details: parsed.error.format(),
      });
    }
    try {
      const feed = await service.getBusinessFeed(parsed.data);
      return reply.send(feed);
    } catch (err: unknown) {
      logger.error({ err }, 'openai-reserve feed failed');
      return reply.status(500).send({ error: 'Internal error' });
    }
  });

  // POST /v1/tools/restaurant_reservation : tool Apps SDK
  // Le tool retourne la structure Apps SDK avec _meta.ui.resourceUri.
  app.post('/v1/tools/restaurant_reservation', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = RestaurantReservationInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid input',
        details: parsed.error.format(),
      });
    }
    try {
      const result = await service.restaurantReservation(parsed.data);
      // Format Apps SDK : _meta.ui.resourceUri indique au runtime
      // qu'il faut charger le widget depuis cette URL.
      return reply.send({
        result,
        _meta: {
          ui: {
            resourceUri: WIDGET_RESOURCE_URI,
          },
        },
      });
    } catch (err: unknown) {
      logger.error({ err }, 'openai-reserve tool failed');
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(404).send({ error: message });
    }
  });

  // GET /v1/tools : list public tools (Apps SDK discovery)
  app.get('/v1/tools', async (_req, reply) => {
    return reply.send({
      tools: [
        {
          name: TOOL_NAME,
          description: 'Open the Sokar restaurant reservation widget for the given restaurant.',
          input_schema: {
            type: 'object',
            properties: {
              restaurant_id: { type: 'string', description: 'Restaurant ID from business feed' },
              restaurant_name: { type: 'string' },
              restaurant_image: { type: 'string' },
              restaurant_address: {
                type: 'object',
                properties: {
                  address: { type: 'string' },
                  city: { type: 'string' },
                  state: { type: 'string' },
                  zipcode: { type: 'string' },
                  country: { type: 'string' },
                },
              },
            },
            required: ['restaurant_id'],
          },
          _meta: {
            ui: {
              resourceUri: WIDGET_RESOURCE_URI,
            },
          },
        },
      ],
    });
  });
}
