import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { env } from '../../env';
import { checkRateLimit } from '../../shared/redis/rate-limit';
import { answerCompanion, CompanionUpstreamError, companionDayKey } from './companion.service';
import { computeTonight } from './tonight';

const DAILY_MESSAGE_LIMIT = 100;
const DAY_SECONDS = 86_400;

const ChatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(20)
    .refine((messages) => messages.at(-1)?.role === 'user', {
      message: 'Le dernier message doit être celui de l’utilisateur.',
    }),
});

// strictObject : un champ en trop (un commentaire libre, par exemple) fait échouer la requête.
const FeedbackBodySchema = z.strictObject({
  responseId: z.uuid(),
  rating: z.enum(['up', 'down']),
});

export async function companionRoutes(app: FastifyInstance) {
  // Avis sur une réponse : aucun texte libre, et seulement en logs.
  // shortcut: avis en logs seulement, table dédiée si le volume le justifie.
  app.post('/companion/feedback', { preHandler: requireOrg() }, async (req, reply) => {
    const body = FeedbackBodySchema.parse(req.body);
    req.log.info({ responseId: body.responseId, rating: body.rating }, 'companion feedback');
    return reply.status(204).send();
  });

  // Carte « Ce soir » : calculée ici, jamais envoyée au modèle. La politique de rôles refuse STAFF et READ_ONLY (403).
  app.get('/companion/tonight', { preHandler: requireOrg() }, async (req, reply) => {
    return reply.send(await computeTonight(req.restaurantId as string, new Date()));
  });

  // Lecture seule côté serveur : la politique de rôles refuse STAFF et READ_ONLY (403).
  app.post('/companion/chat', { preHandler: requireOrg() }, async (req, reply) => {
    const body = ChatBodySchema.parse(req.body);

    if (!env.OPENROUTER_API_KEY?.trim()) {
      return reply.status(503).send({
        error: 'COMPANION_UNAVAILABLE',
        message: 'L’assistant n’est pas disponible pour le moment.',
      });
    }

    const restaurantId = req.restaurantId as string;
    const withinQuota = await checkRateLimit(
      `companion:${restaurantId}:${companionDayKey(new Date())}`,
      DAILY_MESSAGE_LIMIT,
      DAY_SECONDS,
    );
    if (!withinQuota) {
      return reply.status(429).send({
        error: 'COMPANION_DAILY_LIMIT',
        message: `Vous avez atteint la limite de ${DAILY_MESSAGE_LIMIT} messages pour aujourd’hui. Réessayez demain.`,
      });
    }

    try {
      return reply.send(
        await answerCompanion({ restaurantId, messages: body.messages, log: req.log }),
      );
    } catch (error) {
      if (error instanceof CompanionUpstreamError) {
        return reply.status(502).send({
          error: 'COMPANION_UPSTREAM',
          message: 'L’assistant ne peut pas répondre pour le moment. Réessayez dans un instant.',
        });
      }
      throw error;
    }
  });
}
