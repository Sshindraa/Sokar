import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { env } from '../../env';
import { checkRateLimit } from '../../shared/redis/rate-limit';
import { answerCompanion, CompanionUpstreamError, companionDayKey } from './companion.service';
import { BRIEF_LANGUAGES, cachedBrief, computeBrief } from './brief';
import { computeTonight } from './tonight';

const DAILY_MESSAGE_LIMIT = 100;
const DAY_SECONDS = 86_400;

// Langue du résumé : celle du tableau de bord ; une langue inconnue donne le français.
const BriefQuerySchema = z.object({ lang: z.enum(BRIEF_LANGUAGES).catch('fr') });

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

  // Carte « Ce soir » : calculée ici, sans attendre le résumé. Le résumé n'est là que s'il est déjà en
  // cache ; sinon il vient de GET /companion/tonight/brief. La politique de rôles refuse STAFF et READ_ONLY (403).
  app.get('/companion/tonight', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = req.restaurantId as string;
    const card = await computeTonight(restaurantId, new Date());
    const { lang } = BriefQuerySchema.parse(req.query);
    return reply.send({ ...card, brief: await cachedBrief(restaurantId, card, lang) });
  });

  // Résumé de la carte, par le modèle s'il n'est pas en cache. Sans clé OpenRouter, pas de résumé.
  app.get('/companion/tonight/brief', { preHandler: requireOrg() }, async (req, reply) => {
    if (!env.OPENROUTER_API_KEY?.trim()) return reply.send({ brief: null });
    const { lang } = BriefQuerySchema.parse(req.query);
    const brief = await computeBrief({
      restaurantId: req.restaurantId as string,
      now: new Date(),
      language: lang,
      log: req.log,
    });
    return reply.send({ brief });
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
