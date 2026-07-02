import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrg } from '../../plugins/clerk';
import { trackOnboardingEvent, type OnboardingAnalyticsEvent } from '../analytics/events.service';
import { placeOutboundCall } from '../../shared/telnyx/client';
import { logger } from '../../shared/logger/pino';
import { env } from '../../env';
import {
  applyOnboardingTransition,
  computeOnboardingState,
  DEFAULT_HOURS,
  hasUsablePhone,
  ONBOARDING_STEPS,
  type OnboardingTask,
  type OnboardingTaskState,
  UpdateOnboardingSchema,
} from './onboarding.service';
import { invalidateRestaurantContextCache } from './restaurant.service';
import { computeConnectScore } from '../connect/connect-score.service';
import { synthesizeText, isCartesiaConfigured } from '../voice/cartesia-synth';
import { redisCache } from '../../shared/redis/client';

type RestaurantWithIncludes = Prisma.RestaurantGetPayload<{
  include: { personality: true; exposureSettings: true; images: true };
}>;

const ONBOARDING_EVENT_BY_ACTION: Partial<
  Record<z.infer<typeof UpdateOnboardingSchema>['action'], OnboardingAnalyticsEvent>
> = {
  start: 'onboarding_step_started',
  complete: 'onboarding_step_completed',
  skip: 'onboarding_step_skipped',
  block: 'onboarding_step_blocked',
  activate: 'onboarding_activated',
  first_call: 'onboarding_first_call',
};

const CreateRestaurantSchema = z.object({
  name: z.string().min(2).max(100),
  managerPhone: z.string().regex(/^\+?[0-9]{10,15}$/),
  managerEmail: z.string().email(),
  phoneNumber: z.string().min(5),
  openingHours: z.record(
    z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    z.union([z.object({ open: z.string(), close: z.string() }), z.null()]),
  ),
  plan: z.enum(['STARTER', 'PRO', 'PREMIUM']).default('STARTER'),
  googleCalendarId: z.string().nullable().optional(),
});

const UpdatePersonalitySchema = z.object({
  profileType: z.enum(['BISTROT_BRASSERIE', 'GASTRONOMIQUE', 'SEMI_GASTRO']).optional(),
  fillerStyle: z.enum(['CASUAL', 'FORMAL', 'WARM']).optional(),
  speakingRate: z.number().min(0.5).max(2.0).optional(),
  pitchShift: z.number().min(0.5).max(2.0).optional(),
  microphoneThreshold: z.number().int().min(-80).max(0).optional(),
  targetLatencyMs: z.number().int().min(40).max(500).optional(),
  voiceIdCa: z.string().optional(),
  systemPromptExtra: z.string().max(2000).optional(),
});

const UpdateConnectSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .optional(),
  description: z.string().max(200).optional().nullable(),
  formattedAddress: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  country: z.string().max(10).default('FR').optional(),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  cuisineType: z.array(z.string()).optional(),
  priceRange: z.number().min(1).max(4).optional().nullable(),
  ambiance: z.array(z.string()).optional(),
  dietary: z.array(z.string()).optional(),
  coverImageUrl: z.string().optional().nullable(),
  maxPartySize: z.number().int().min(1).max(100).optional(),
  connectPublished: z.boolean().optional(),
  connectAgentic: z.boolean().optional(),
  capacitySpecials: z
    .object({
      totalCapacity: z.number().int().optional(),
      serviceDuration: z.number().int().optional(),
      cancellationPolicy: z.string().max(280).optional(),
      depositRequired: z.boolean().optional(),
      depositAmount: z.number().optional(),
      depositThreshold: z.number().int().optional(),
    })
    .optional(),
});

const PostImageSchema = z.object({
  url: z.string(),
  isCover: z.boolean().default(false),
  position: z.number().int().default(0),
  alt: z.string().optional(),
});

function onboardingPayload(
  restaurant: RestaurantWithIncludes,
  state = computeOnboardingState(restaurant),
) {
  return {
    onboardingDone: state.onboardingDone,
    voiceOnboardingDone: state.voiceOnboardingDone,
    connectOnboardingDone: state.connectOnboardingDone,
    minimumViableDone: state.minimumViableDone,
    onboardingCompletedAt: restaurant.onboardingCompletedAt,
    onboardingActivatedAt: restaurant.onboardingActivatedAt,
    onboardingLastSeenAt: restaurant.onboardingLastSeenAt,
    firstCallAt: restaurant.firstCallAt,
    currentStep: state.currentStep,
    completedCount: state.completedCount,
    totalCount: ONBOARDING_STEPS.length,
    progress: state.progress,
    voiceProgress: state.voiceProgress,
    connectProgress: state.connectProgress,
    steps: state.steps,
    defaultHours: DEFAULT_HOURS,
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      managerPhone: restaurant.managerPhone,
      managerEmail: restaurant.managerEmail,
      phoneNumber: restaurant.phoneNumber,
      phoneAssigned: hasUsablePhone(restaurant.phoneNumber),
      openingHours: restaurant.openingHours,
      googleCalendarId: restaurant.googleCalendarId,
      googleConnected: Boolean(restaurant.googleRefreshToken),
      personality: restaurant.personality,
      // Sokar Connect
      slug: restaurant.slug,
      description: restaurant.description,
      formattedAddress: restaurant.formattedAddress,
      city: restaurant.city,
      postalCode: restaurant.postalCode,
      country: restaurant.country,
      lat: restaurant.lat ? Number(restaurant.lat) : null,
      lng: restaurant.lng ? Number(restaurant.lng) : null,
      cuisineType: restaurant.cuisineType,
      priceRange: restaurant.priceRange,
      ambiance: restaurant.ambiance,
      dietary: restaurant.dietary,
      coverImageUrl: restaurant.coverImageUrl,
      images: restaurant.images || [],
      exposureSettings: restaurant.exposureSettings || null,
    },
  };
}

export async function restaurantRoutes(app: FastifyInstance) {
  const getOnboarding = async (req: FastifyRequest, reply: FastifyReply) => {
    const restaurantId = req.restaurantId;
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true, exposureSettings: true, images: true },
    });
    const state = computeOnboardingState(restaurant);
    const completedAt =
      state.onboardingDone && !restaurant.onboardingCompletedAt
        ? new Date()
        : restaurant.onboardingCompletedAt;

    const updated = await app.db.restaurant.update({
      where: { id: restaurantId },
      data: {
        onboardingTasks: state.tasks as unknown as Prisma.InputJsonValue,
        onboardingDone: state.onboardingDone,
        onboardingCompletedAt: completedAt,
        onboardingLastSeenAt: new Date(),
      },
      include: { personality: true, exposureSettings: true, images: true },
    });

    return reply.send(onboardingPayload(updated, computeOnboardingState(updated)));
  };

  const patchOnboarding = async (req: FastifyRequest, reply: FastifyReply) => {
    const restaurantId = req.restaurantId;
    const body = UpdateOnboardingSchema.parse(req.body ?? {});
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true, exposureSettings: true, images: true },
    });

    if (
      body.action === 'complete' &&
      body.task === 'phone' &&
      !hasUsablePhone(restaurant.phoneNumber)
    ) {
      return reply.status(409).send({
        error:
          "Aucun numéro Sokar attribué. Cette étape sera déverrouillée dès qu'un numéro sera ajouté au restaurant.",
      });
    }

    const currentState = computeOnboardingState(restaurant);
    if (body.action === 'activate' && !currentState.onboardingDone) {
      return reply.status(409).send({
        error:
          "La mise en service ne peut pas être activée tant que l'onboarding n'est pas complet.",
      });
    }

    let tasks: Record<OnboardingTask, OnboardingTaskState>;
    try {
      tasks = applyOnboardingTransition(currentState.tasks, body);
    } catch (err: unknown) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const nextState = computeOnboardingState({ ...restaurant, onboardingTasks: tasks });
    const now = new Date();
    const updated = await app.db.restaurant.update({
      where: { id: restaurantId },
      data: {
        onboardingTasks: nextState.tasks as unknown as Prisma.InputJsonValue,
        onboardingDone: nextState.onboardingDone,
        onboardingCompletedAt:
          nextState.onboardingDone && !restaurant.onboardingCompletedAt
            ? now
            : restaurant.onboardingCompletedAt,
        onboardingActivatedAt:
          body.action === 'activate' && !restaurant.onboardingActivatedAt
            ? now
            : restaurant.onboardingActivatedAt,
        firstCallAt:
          body.action === 'first_call' && !restaurant.firstCallAt ? now : restaurant.firstCallAt,
        onboardingLastSeenAt: now,
      },
      include: { personality: true, exposureSettings: true, images: true },
    });

    const updatedState = computeOnboardingState(updated);
    const event = ONBOARDING_EVENT_BY_ACTION[body.action];
    if (event) {
      trackOnboardingEvent({
        event,
        restaurantId,
        userId: req.userId,
        task: body.task,
        metadata: {
          ...body.metadata,
          progress: updatedState.progress,
          completedCount: updatedState.completedCount,
          onboardingDone: updatedState.onboardingDone,
          reason: body.reason,
        },
      }).catch((err) => app.log.error({ err, restaurantId }, 'trackOnboardingEvent failed'));
    }

    // ─── Re-engagement : replace le timer à chaque interaction
    // Si onboardé mais pas de firstCall → rappel J+7 "testez votre assistant"
    // Sinon → rappel J+3 "il vous reste X étapes"
    const reengagementType: 'stalled' | 'inactive' | null = updatedState.onboardingDone
      ? updated.firstCallAt
        ? null
        : 'inactive'
      : updatedState.onboardingDone === false
        ? 'stalled'
        : null;
    if (reengagementType) {
      const delayDays = reengagementType === 'inactive' ? 7 : 3;
      const jobName = `reengagement-${reengagementType}`;
      await app.queues.onboarding.add(
        `${jobName}-${restaurantId}`,
        { restaurantId, type: reengagementType },
        { delay: delayDays * 24 * 60 * 60 * 1000, jobId: `${jobName}-${restaurantId}` },
      );
    }

    return reply.send(onboardingPayload(updated, updatedState));
  };

  app.post('/restaurants', { preHandler: requireOrg() }, async (req, reply) => {
    const body = CreateRestaurantSchema.parse(req.body);
    try {
      const restaurant = await app.db.restaurant.create({
        data: body as Prisma.RestaurantUncheckedCreateInput,
      });
      await app.queues.eveningReport.upsertJobScheduler(
        `nightly-${restaurant.id}`,
        { pattern: '0 23 * * *', tz: 'Europe/Paris' },
        { name: 'nightly', data: { restaurantId: restaurant.id } },
      );
      return reply.status(201).send(restaurant);
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === 'P2002') {
        return reply.status(409).send({ error: 'Phone number already registered' });
      }
      throw err;
    }
  });

  app.get('/restaurant/onboarding', { preHandler: requireOrg() }, getOnboarding);
  app.get('/api/restaurant/onboarding', { preHandler: requireOrg() }, getOnboarding);
  app.patch('/restaurant/onboarding', { preHandler: requireOrg() }, patchOnboarding);
  app.patch('/api/restaurant/onboarding', { preHandler: requireOrg() }, patchOnboarding);

  app.get('/restaurants/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    return reply.send(
      await app.db.restaurant.findUniqueOrThrow({ where: { id }, include: { personality: true } }),
    );
  });

  app.get('/restaurants/:id/public', async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const restaurant = await app.db.restaurant.findUniqueOrThrow({
        where: { id },
        select: {
          id: true,
          name: true,
          openingHours: true,
          phoneNumber: true,
        },
      });
      return reply.send(restaurant);
    } catch (err) {
      app.log.error({ err }, 'Restaurant fetch failed');
      return reply.status(404).send({ error: 'Restaurant not found' });
    }
  });

  // Public route by slug — used by the embeddable widget (sokar.tech/widget/{slug}).
  // Renvoie les champs nécessaires au rendu de l'iframe + l'id Prisma
  // pour que le widget puisse enchaîner sur les routes /restaurants/{id}/*.
  // Pas d'auth : endpoint public, même politique que /restaurants/:id/public.
  //
  // Note : on n'utilise PAS /public/r/:slug (déjà déclaré par Sokar Connect) parce
  // que ce dernier filtre sur connectPublished. Le widget doit fonctionner
  // pour tous les restos, pas seulement ceux publiés sur Sokar Connect.
  app.get('/public/widget/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string };
    try {
      const restaurant = await app.db.restaurant.findUniqueOrThrow({
        where: { slug },
        select: {
          id: true,
          name: true,
          openingHours: true,
          phoneNumber: true,
          // Champs Sokar Connect utiles pour le rendu
          city: true,
          cuisineType: true,
          coverImageUrl: true,
          formattedAddress: true,
        },
      });
      return reply.send(restaurant);
    } catch (err) {
      app.log.error({ err, slug }, 'Restaurant fetch by slug (widget) failed');
      return reply.status(404).send({ error: 'Restaurant not found' });
    }
  });

  // ─── Preview public (mode démo hybride) ───────────────────────────
  // Sert les données du restaurant démo "Chez Sokar" (slug: chez-sokar-demo)
  // aux utilisateurs non-onboardés pour explorer le produit en lecture seule.
  // Pas d'auth : endpoint public. Aucune donnée sensible (pas de tokens,
  // pas d'API keys MCP, pas de refresh tokens Google).
  app.get('/public/preview/restaurant', async (_req, reply) => {
    try {
      const restaurant = await app.db.restaurant.findFirst({
        where: { slug: 'chez-sokar-demo' },
        select: {
          id: true,
          name: true,
          managerPhone: true,
          managerEmail: true,
          phoneNumber: true,
          openingHours: true,
          googleCalendarId: true,
          slug: true,
          description: true,
          formattedAddress: true,
          city: true,
          postalCode: true,
          country: true,
          lat: true,
          lng: true,
          cuisineType: true,
          priceRange: true,
          ambiance: true,
          dietary: true,
          coverImageUrl: true,
          plan: true,
          personality: { select: { profileType: true, fillerStyle: true, speakingRate: true } },
          exposureSettings: {
            select: {
              connectPublished: true,
              connectAgentic: true,
              maxPartySize: true,
              capacitySpecials: true,
            },
          },
          images: { select: { url: true, isCover: true, position: true, alt: true } },
        },
      });

      if (!restaurant) {
        return reply.status(404).send({ error: 'Demo restaurant not found' });
      }

      // Récupère quelques appels, réservations et clients fictifs pour la démo
      const [calls, reservations, customers] = await Promise.all([
        app.db.call
          .findMany({
            where: { restaurantId: restaurant.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              createdAt: true,
              durationSec: true,
              intent: true,
              outcome: true,
              carrier: true,
            },
          })
          .catch(() => []),
        app.db.reservation
          .findMany({
            where: { restaurantId: restaurant.id },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: {
              id: true,
              customerName: true,
              customerPhone: true,
              partySize: true,
              reservedAt: true,
              status: true,
              estimatedRevenue: true,
            },
          })
          .catch(() => []),
        app.db.customer
          .findMany({
            where: { restaurantId: restaurant.id },
            take: 10,
            select: {
              id: true,
              name: true,
              phone: true,
              visitCount: true,
              isVip: true,
              notes: true,
              lastSeenAt: true,
            },
          })
          .catch(() => []),
      ]);

      return reply.send({
        restaurant: {
          ...restaurant,
          lat: restaurant.lat ? Number(restaurant.lat) : null,
          lng: restaurant.lng ? Number(restaurant.lng) : null,
        },
        calls,
        reservations,
        customers,
        isPreview: true,
      });
    } catch (err) {
      app.log.error({ err }, 'Preview restaurant fetch failed');
      return reply.status(500).send({ error: 'Failed to load preview' });
    }
  });

  app.patch('/restaurants/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = CreateRestaurantSchema.partial().parse(req.body);
    const current = await app.db.restaurant.findUniqueOrThrow({
      where: { id },
      select: { phoneNumber: true },
    });
    const updated = await app.db.restaurant.update({ where: { id }, data: body });
    await Promise.all(
      Array.from(new Set([current.phoneNumber, updated.phoneNumber])).map((phoneNumber) =>
        invalidateRestaurantContextCache(phoneNumber),
      ),
    );
    // Invalider le cache Connect (données publiques du restaurant)
    if (updated.slug) {
      await app.redisCache.del(`connect:restaurant:${updated.slug}`).catch(() => {});
    }
    return reply.send(updated);
  });

  // ─── Personnalité de l'agent vocal ─────────────────────────────

  app.get('/restaurants/:id/personality', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const personality = await app.db.agentPersonality.findUnique({ where: { restaurantId: id } });
    return reply.send(personality ?? {});
  });

  app.patch('/restaurants/:id/personality', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = UpdatePersonalitySchema.parse(req.body);

    const personality = await app.db.agentPersonality.upsert({
      where: { restaurantId: id },
      create: { restaurantId: id, ...body },
      update: body,
    });

    // Invalider le cache du restaurant pour que le nouveau system prompt soit pris en compte
    const restaurant = await app.db.restaurant.findUniqueOrThrow({ where: { id } });
    await invalidateRestaurantContextCache(restaurant.phoneNumber);

    return reply.send(personality);
  });

  // ─── Appel test onboarding : le gérant entend l'IA sur SON propre numéro ──
  // Démontre concrètement que l'assistant vocal fonctionne et marque
  // l'activation (première mise en service audible).

  const TestCallSchema = z.object({
    phoneNumber: z.string().regex(/^\+[1-9]\d{9,14}$/, 'Numéro E.164 requis (ex: +33612345678)'),
  });

  const postTestCall = async (req: FastifyRequest, reply: FastifyReply) => {
    const restaurantId = req.restaurantId;
    const body = TestCallSchema.parse(req.body ?? {});
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true },
    });

    if (!hasUsablePhone(restaurant.phoneNumber)) {
      return reply.status(409).send({
        code: 'NO_PHONE_ASSIGNED',
        error:
          "Aucun numéro Sokar attribué à ce restaurant. L'équipe Sokar doit d'abord vous attribuer un numéro dédié. Contactez le support si l'attribution tarde.",
      });
    }

    const baseUrl = process.env.PUBLIC_API_URL ?? `${req.protocol}://${req.headers.host}`;
    const webhookUrl = `${baseUrl}/voice/stream`;

    try {
      const { callControlId } = await placeOutboundCall(body.phoneNumber, {
        webhookUrl,
        clientState: {
          kind: 'onboarding_test_call',
          restaurantId,
          targetManagerPhone: body.phoneNumber,
        },
        timeoutSecs: 30,
      });

      const now = new Date();
      const updated = await app.db.restaurant.update({
        where: { id: restaurantId },
        data: {
          firstCallAt: restaurant.firstCallAt ?? now,
          onboardingLastSeenAt: now,
        },
        include: { personality: true },
      });

      trackOnboardingEvent({
        event: 'onboarding_first_call',
        restaurantId,
        userId: req.userId,
        task: 'phone',
        metadata: {
          callControlId,
          phoneNumber: body.phoneNumber,
          progress: computeOnboardingState(updated).progress,
        },
      }).catch((err) => app.log.error({ err, restaurantId }, 'trackOnboardingEvent failed'));

      return reply.send({
        ok: true,
        callControlId,
        message: 'Appel test déclenché. Vous allez recevoir un appel sous quelques secondes.',
      });
    } catch (err: unknown) {
      logger.error(
        { err, restaurantId, target: body.phoneNumber },
        '[onboarding] test call failed',
      );
      return reply.status(502).send({
        code: 'TELNYX_FAILED',
        error:
          "L'appel test n'a pas pu être déclenché (opérateur injoignable ou erreur réseau). Réessayez dans quelques minutes, ou contactez le support si le problème persiste.",
        detail:
          process.env.NODE_ENV === 'production'
            ? undefined
            : String(err instanceof Error ? err.message : err),
      });
    }
  };

  // ─── Demo call (audio preview, pas d'appel Telnyx réel) ────────────────
  // Synthétise un script fixe avec la personnalité courante du restaurant
  // pour donner un aha moment mid-onboarding (étape 3, avant l'étape phone).
  // Fallback transcript-only si CARTESIA_API_KEY absente (dev local par design).
  const DemoCallSchema = z.object({
    scriptId: z.enum(['reservation', 'cancellation', 'menu']).default('reservation'),
  });

  const DEMO_SCRIPTS: Record<string, (name: string) => string> = {
    reservation: (name) =>
      `Bonjour, ${name}. Oui, une table pour quatre personnes ce vendredi à dix-neuf heures, c'est noté. À vendredi !`,
    cancellation: (name) =>
      `Bonjour, ${name}. Bien sûr, j'annule votre réservation de ce soir. Souhaitez-vous la reporter à une autre date ?`,
    menu: (name) =>
      `Bonjour, ${name}. Ce soir, en plat du jour, nous avons un confit de canard avec pommes sarladaises. Souhaitez-vous réserver une table ?`,
  };

  const postDemoCall = async (req: FastifyRequest, reply: FastifyReply) => {
    const restaurantId = req.restaurantId;
    const body = DemoCallSchema.parse(req.body ?? {});
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true },
    });

    const scriptFn = DEMO_SCRIPTS[body.scriptId] ?? DEMO_SCRIPTS.reservation;
    const transcript = scriptFn(restaurant.name);

    if (!isCartesiaConfigured()) {
      // Dev local par design : pas de clé Cartesia → transcript seul.
      return reply.send({
        audio: null,
        transcript,
        scriptId: body.scriptId,
        fallback: true,
        message: 'Audio disponible après configuration de la clé Cartesia.',
      });
    }

    // Cache Redis 5 min : évite un 2e call Cartesia (~1s) quand l'utilisateur
    // rejoue le même scénario ou change puis revient. La clé inclut le
    // scriptId + le speakingRate pour invalider si la personnalité change.
    const speed = restaurant.personality?.speakingRate
      ? Number(restaurant.personality.speakingRate)
      : undefined;
    const cacheKey = `demo-call:${restaurantId}:${body.scriptId}:${speed ?? 'default'}`;
    const cached = await redisCache.getBuffer(cacheKey);
    if (cached) {
      // Hit cache : on track l'event quand même (l'utilisateur a écouté)
      trackOnboardingEvent({
        event: 'onboarding_demo_call_played',
        restaurantId,
        userId: req.userId,
        task: 'knowledge',
        metadata: { scriptId: body.scriptId, hasAudio: true, cached: true },
      }).catch((err) => app.log.error({ err, restaurantId }, 'trackOnboardingEvent failed'));

      reply.type('audio/mpeg');
      return reply.send(cached);
    }

    try {
      const audio = await synthesizeText({ text: transcript, speed });

      if (!audio) {
        return reply.send({ audio: null, transcript, scriptId: body.scriptId, fallback: true });
      }

      // Stocke l'audio en cache pour 5 minutes
      await redisCache.set(cacheKey, audio, 'EX', 300);

      trackOnboardingEvent({
        event: 'onboarding_demo_call_played',
        restaurantId,
        userId: req.userId,
        task: 'knowledge',
        metadata: { scriptId: body.scriptId, hasAudio: true },
      }).catch((err) => app.log.error({ err, restaurantId }, 'trackOnboardingEvent failed'));

      reply.type('audio/mpeg');
      return reply.send(audio);
    } catch (err: unknown) {
      logger.error(
        { err, restaurantId, scriptId: body.scriptId },
        '[onboarding] demo call TTS failed',
      );
      return reply.status(502).send({
        code: 'CARTESIA_FAILED',
        error:
          "La synthèse vocale n'a pas pu être générée. Réessayez dans quelques minutes, ou contactez le support si le problème persiste.",
        transcript,
        detail:
          process.env.NODE_ENV === 'production'
            ? undefined
            : String(err instanceof Error ? err.message : err),
      });
    }
  };

  const patchConnect = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = UpdateConnectSchema.parse(req.body ?? {});

    // 1. Check slug uniqueness if provided
    if (body.slug) {
      const existing = await app.db.restaurant.findUnique({
        where: { slug: body.slug },
      });
      if (existing && existing.id !== restaurantId) {
        return reply
          .status(409)
          .send({ error: 'Ce slug est déjà utilisé par un autre restaurant.' });
      }
    }

    // 2. Fetch existing settings to merge capacitySpecials
    const currentSettings = await app.db.restaurantExposureSettings.upsert({
      where: { restaurantId },
      create: { restaurantId },
      update: {},
    });

    const currentCapacitySpecials =
      (currentSettings.capacitySpecials as Record<string, unknown>) || {};
    const newCapacitySpecials = {
      ...currentCapacitySpecials,
      ...(body.capacitySpecials || {}),
    };

    // 3. Prepare updates
    const now = new Date();
    const restaurantData: Prisma.RestaurantUpdateInput = {};
    if (body.slug !== undefined) restaurantData.slug = body.slug;
    if (body.description !== undefined) restaurantData.description = body.description;
    if (body.formattedAddress !== undefined)
      restaurantData.formattedAddress = body.formattedAddress;
    if (body.city !== undefined) restaurantData.city = body.city;
    if (body.postalCode !== undefined) restaurantData.postalCode = body.postalCode;
    if (body.country !== undefined) restaurantData.country = body.country;
    if (body.lat !== undefined) restaurantData.lat = body.lat;
    if (body.lng !== undefined) restaurantData.lng = body.lng;
    if (body.cuisineType !== undefined) restaurantData.cuisineType = body.cuisineType;
    if (body.priceRange !== undefined) restaurantData.priceRange = body.priceRange;
    if (body.ambiance !== undefined) restaurantData.ambiance = body.ambiance;
    if (body.dietary !== undefined) restaurantData.dietary = body.dietary;
    if (body.coverImageUrl !== undefined) restaurantData.coverImageUrl = body.coverImageUrl;

    // Gating activation / publication
    if (body.connectPublished) {
      restaurantData.publishedAt = now;
      restaurantData.agenticOptIn = true;
    }

    const settingsData: Prisma.RestaurantExposureSettingsUpdateInput = {
      capacitySpecials: newCapacitySpecials as unknown as Prisma.InputJsonValue,
    };
    if (body.maxPartySize !== undefined) settingsData.maxPartySize = body.maxPartySize;
    if (body.connectPublished !== undefined) {
      settingsData.connectPublished = body.connectPublished;
      if (body.connectPublished) {
        settingsData.connectPublishedAt = now;
      }
    }
    if (body.connectAgentic !== undefined) settingsData.connectAgentic = body.connectAgentic;

    // 4. Update Database in a transaction
    const [updatedRestaurant, updatedSettings] = await app.db.$transaction([
      app.db.restaurant.update({
        where: { id: restaurantId },
        data: restaurantData,
        include: { personality: true, images: true },
      }),
      app.db.restaurantExposureSettings.update({
        where: { restaurantId },
        data: settingsData,
      }),
    ]);

    // Invalidate caches
    await invalidateRestaurantContextCache(updatedRestaurant.phoneNumber);
    if (updatedRestaurant.slug) {
      const cacheKey = `connect:restaurant:${updatedRestaurant.slug}`;
      await app.redisCache.del(cacheKey);
    }

    return reply.send({
      restaurant: updatedRestaurant,
      exposureSettings: updatedSettings,
    });
  };

  const postImage = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = PostImageSchema.parse(req.body ?? {});

    if (body.isCover) {
      await app.db.restaurantImage.updateMany({
        where: { restaurantId, isCover: true },
        data: { isCover: false },
      });
    }

    const image = await app.db.restaurantImage.create({
      data: {
        restaurantId,
        url: body.url,
        isCover: body.isCover,
        position: body.position,
        alt: body.alt,
      },
    });

    if (body.isCover) {
      await app.db.restaurant.update({
        where: { id: restaurantId },
        data: { coverImageUrl: body.url },
      });
    }

    return reply.status(201).send(image);
  };

  const checkSlug = async (req: FastifyRequest, reply: FastifyReply) => {
    const { slug } = req.query as { slug?: string };
    if (!slug) {
      return reply.status(400).send({ error: 'Slug requis' });
    }
    const regex = /^[a-z0-9-]+$/;
    if (!regex.test(slug)) {
      return reply.status(400).send({
        error: 'Format du slug invalide (lettres minuscules, chiffres, tirets uniquement)',
      });
    }
    const existing = await app.db.restaurant.findUnique({
      where: { slug },
    });
    const available = !existing || existing.id === req.restaurantId;
    return reply.send({ available });
  };

  app.post('/restaurant/onboarding/test-call', { preHandler: requireOrg() }, postTestCall);
  app.post('/api/restaurant/onboarding/test-call', { preHandler: requireOrg() }, postTestCall);

  app.post('/restaurant/onboarding/demo-call', { preHandler: requireOrg() }, postDemoCall);
  app.post('/api/restaurant/onboarding/demo-call', { preHandler: requireOrg() }, postDemoCall);

  app.patch('/restaurants/:id/connect', { preHandler: requireOrg() }, patchConnect);
  app.patch('/api/restaurants/:id/connect', { preHandler: requireOrg() }, patchConnect);

  // Sokar Connect — GET settings
  // Returns the restaurant's Sokar Connect configuration (gating flags, slug, page URL).
  const getConnect = async (req: FastifyRequest, reply: FastifyReply) => {
    const restaurantId = req.restaurantId;

    const restaurant = await app.db.restaurant.findUnique({
      where: { id: restaurantId },
      include: { exposureSettings: true },
    });

    if (!restaurant) {
      return reply.status(404).send({ error: 'Restaurant not found' });
    }

    const slug = restaurant.slug;
    const exposure = restaurant.exposureSettings;

    return reply.send({
      restaurantId,
      slug,
      name: restaurant.name,
      connectPublished: exposure?.connectPublished ?? false,
      connectAgentic: exposure?.connectAgentic ?? false,
      connectPublishedAt: exposure?.connectPublishedAt?.toISOString() ?? null,
      pageUrl: slug ? `${env.SITE_URL}/restaurant/${slug}` : null,
    });
  };

  app.get('/restaurants/:id/connect', { preHandler: requireOrg() }, getConnect);
  app.get('/api/restaurants/:id/connect', { preHandler: requireOrg() }, getConnect);

  // Sokar Connect — GET score de complétude
  // Calcule le score de profil 0-100% + items manquants + copy contextuel.
  const getConnectScore = async (req: FastifyRequest, reply: FastifyReply) => {
    const restaurantId = req.restaurantId;

    const restaurant = await app.db.restaurant.findUnique({
      where: { id: restaurantId },
      include: {
        exposureSettings: true,
        images: { select: { id: true } },
      },
    });

    if (!restaurant) {
      return reply.status(404).send({ error: 'Restaurant not found' });
    }

    const score = computeConnectScore({
      restaurant,
      exposure: restaurant.exposureSettings,
      images: restaurant.images,
    });

    return reply.send(score);
  };

  app.get('/restaurants/:id/connect/score', { preHandler: requireOrg() }, getConnectScore);
  app.get('/api/restaurants/:id/connect/score', { preHandler: requireOrg() }, getConnectScore);

  app.post('/restaurants/:id/images', { preHandler: requireOrg() }, postImage);
  app.post('/api/restaurants/:id/images', { preHandler: requireOrg() }, postImage);
  app.get('/restaurants/check-slug', { preHandler: requireOrg() }, checkSlug);
  app.get('/api/restaurants/check-slug', { preHandler: requireOrg() }, checkSlug);
}
