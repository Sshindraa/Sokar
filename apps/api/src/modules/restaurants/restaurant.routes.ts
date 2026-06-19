import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { trackOnboardingEvent, type OnboardingAnalyticsEvent } from '../analytics/events.service';
import { placeOutboundCall } from '../../shared/telnyx/client';
import { logger } from '../../shared/logger/pino';
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

function onboardingPayload(restaurant: any, state = computeOnboardingState(restaurant)) {
  return {
    onboardingDone: state.onboardingDone,
    onboardingCompletedAt: restaurant.onboardingCompletedAt,
    onboardingActivatedAt: restaurant.onboardingActivatedAt,
    onboardingLastSeenAt: restaurant.onboardingLastSeenAt,
    firstCallAt: restaurant.firstCallAt,
    currentStep: state.currentStep,
    completedCount: state.completedCount,
    totalCount: ONBOARDING_STEPS.length,
    progress: state.progress,
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
    },
  };
}

export async function restaurantRoutes(app: FastifyInstance) {
  const getOnboarding = async (req: any, reply: any) => {
    const restaurantId = req.restaurantId;
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true },
    });
    const state = computeOnboardingState(restaurant);
    const completedAt =
      state.onboardingDone && !restaurant.onboardingCompletedAt
        ? new Date()
        : restaurant.onboardingCompletedAt;

    const updated = await app.db.restaurant.update({
      where: { id: restaurantId },
      data: {
        onboardingTasks: state.tasks as any,
        onboardingDone: state.onboardingDone,
        onboardingCompletedAt: completedAt,
        onboardingLastSeenAt: new Date(),
      },
      include: { personality: true },
    });

    return reply.send(onboardingPayload(updated, computeOnboardingState(updated)));
  };

  const patchOnboarding = async (req: any, reply: any) => {
    const restaurantId = req.restaurantId;
    const body = UpdateOnboardingSchema.parse(req.body ?? {});
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true },
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
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    const nextState = computeOnboardingState({ ...restaurant, onboardingTasks: tasks });
    const now = new Date();
    const updated = await app.db.restaurant.update({
      where: { id: restaurantId },
      data: {
        onboardingTasks: nextState.tasks as any,
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
      include: { personality: true },
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
      const restaurant = await app.db.restaurant.create({ data: body as any });
      await app.queues.eveningReport.upsertJobScheduler(
        `nightly-${restaurant.id}`,
        { pattern: '0 23 * * *', tz: 'Europe/Paris' },
        { name: 'nightly', data: { restaurantId: restaurant.id } },
      );
      return reply.status(201).send(restaurant);
    } catch (err: any) {
      if (err.code === 'P2002') {
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

  app.patch('/restaurants/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId;
    if (id !== restaurantId) {
      return reply.status(403).send({ error: 'Forbidden' });
    }
    const body = CreateRestaurantSchema.partial().parse(req.body);
    const updated = await app.db.restaurant.update({ where: { id }, data: body });
    await app.redisCache.del(`phone:${updated.phoneNumber}`);
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
    await app.redisCache.del(`phone:${restaurant.phoneNumber}`);

    return reply.send(personality);
  });

  // ─── Appel test onboarding : le gérant entend l'IA sur SON propre numéro ──
  // Démontre concrètement que l'assistant vocal fonctionne et marque
  // l'activation (première mise en service audible).

  const TestCallSchema = z.object({
    phoneNumber: z.string().regex(/^\+[1-9]\d{9,14}$/, 'Numéro E.164 requis (ex: +33612345678)'),
  });

  const postTestCall = async (req: any, reply: any) => {
    const restaurantId = req.restaurantId;
    const body = TestCallSchema.parse(req.body ?? {});
    const restaurant = await app.db.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { personality: true },
    });

    if (!hasUsablePhone(restaurant.phoneNumber)) {
      return reply.status(409).send({
        error:
          "Aucun numéro Sokar attribué. Active d'abord la mise en service du téléphone avec l'équipe Sokar.",
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
        message: 'Appel test déclenché. Tu vas recevoir un appel sous quelques secondes.',
      });
    } catch (err: any) {
      logger.error(
        { err, restaurantId, target: body.phoneNumber },
        '[onboarding] test call failed',
      );
      return reply.status(502).send({
        error: "L'appel test n'a pas pu être déclenché. Réessaie ou contacte le support.",
        detail: process.env.NODE_ENV === 'production' ? undefined : String(err?.message ?? err),
      });
    }
  };

  app.post('/restaurant/onboarding/test-call', { preHandler: requireOrg() }, postTestCall);
  app.post('/api/restaurant/onboarding/test-call', { preHandler: requireOrg() }, postTestCall);
}
