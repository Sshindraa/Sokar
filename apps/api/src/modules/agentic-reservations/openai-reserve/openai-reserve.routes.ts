/**
 * Routes OpenAI Reserve : business feed + tool restaurant_reservation.
 *
 * Spec : https://developers.openai.com/apps-sdk/guides/restaurant-reservation-conversion-spec
 *
 * Routes :
 *   GET  /v1/businesses           : feed paginé (filtre openaiReserveEnabled)
 *   POST /v1/tools/restaurant_reservation : tool Apps SDK conforme spec
 *   GET  /v1/tools                : discovery (liste les tools publics)
 *
 * ─── Risque accepté ─────────────────────────────────────────────────
 *
 * Ce feed est intentionnellement public et sans auth (requis par OpenAI
 * Apps SDK). Risque accepté : un tiers non-partenaire peut scraper cette
 * liste de restaurants (nom, adresse, téléphone, coordonnées GPS, cuisine,
 * prix, horaires).
 *
 * Mitigations en place :
 *   1. Rate limit 30 req/min/IP sur toutes les routes /v1/* (étape 1)
 *   2. Cache Redis TTL 120s sur getBusinessFeed() — le scraping répété
 *      tape le cache, pas la DB (étape 2)
 *   3. Métrique Prometheus sokar_openai_reserve_feed_requests_total{status}
 *      pour détecter un volume anormal (étape 3)
 *
 * Pas de bearer token car OpenAI ingère ce endpoint publiquement sans
 * authentification, cf. spec Apps SDK. Ne PAS ajouter d'auth obligatoire
 * sans une coordination explicite avec OpenAI — ça casserait l'ingestion.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OpenaiReserveService } from './openai-reserve.service';
import { WIDGET_RESOURCE_URI, TOOL_NAME } from './constants';
import { FeedQuerySchema, RestaurantReservationInputSchema } from './schemas';
import { logger } from '../../../shared/logger/pino';
import { db } from '../../../shared/db/client';
import { openaiReserveFeedRequestsTotal } from '../../../shared/observability/metrics';

export async function openaiReserveRoutes(app: FastifyInstance): Promise<void> {
  const service = new OpenaiReserveService(db);

  // GET /v1/businesses : business feed
  // Rate limit 30 req/min/IP — généreux pour le crawl OpenAI (polling
  // occasionnel, pas burst), bloque le scraping agressif. Pas d'auth car
  // OpenAI ingère ce endpoint publiquement (cf. commentaire en tête de fichier).
  app.get(
    '/v1/businesses',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = FeedQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        openaiReserveFeedRequestsTotal.inc({ status: '400' });
        return reply.status(400).send({
          error: 'Invalid query',
          details: parsed.error.format(),
        });
      }
      try {
        const feed = await service.getBusinessFeed(parsed.data);
        openaiReserveFeedRequestsTotal.inc({ status: '200' });
        return reply.send(feed);
      } catch (err: unknown) {
        logger.error({ err }, 'openai-reserve feed failed');
        openaiReserveFeedRequestsTotal.inc({ status: '500' });
        return reply.status(500).send({ error: 'Internal error' });
      }
    },
  );

  // POST /v1/tools/restaurant_reservation : tool Apps SDK
  // Le tool retourne la structure Apps SDK avec _meta.ui.resourceUri.
  // Rate limit 30 req/min/IP — cohérent avec le feed.
  app.post(
    '/v1/tools/restaurant_reservation',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req: FastifyRequest, reply: FastifyReply) => {
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
    },
  );

  // GET /v1/tools : list public tools (Apps SDK discovery)
  // Rate limit 30 req/min/IP — cohérent avec les autres routes /v1/*.
  app.get(
    '/v1/tools',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (_req, reply) => {
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
    },
  );
}
