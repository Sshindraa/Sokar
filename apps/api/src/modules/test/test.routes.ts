import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WebSocket } from 'ws';
import { db } from '../../shared/db/client';
import { RestaurantService } from '../restaurants/restaurant.service';
import { CustomerService } from '../customers/customer.service';
import { buildSystemPrompt, type OpeningHours } from '../voice/prompts';
import { CallSessionManager } from '../voice/stream/manager';
import { logger } from '../../shared/logger/pino';

const SimulateCallSchema = z.object({
  /** Numéro de l'appelant */
  callerPhone: z.string().min(5),
  /** Optionnel : numéro du restaurant (défaut = Chez Sokar démo) */
  restaurantPhone: z.string().min(5).optional(),
  /** Mode LLM : auto (clé OpenRouter requise) ou mock (réponses fixes) */
  mode: z.enum(['auto', 'mock']).default('auto'),
});

const SimulateUtteranceSchema = z.object({
  callControlId: z.string().min(1),
  transcript: z.string().min(1),
});

/**
 * Crée un faux WebSocket utilisable par CallSessionManager en mode simulation.
 * Il ignore les messages audio/TTS et logue ce qui serait envoyé à Telnyx.
 */
function createFakeTelnyxWs(): WebSocket {
  const ws = {
    readyState: WebSocket.OPEN,
    send: (data: unknown) => {
      try {
        const parsed = JSON.parse(typeof data === 'string' ? data : String(data));
        if (parsed.event === 'media') {
          // En mode simulation on ignore le flux audio retourné.
          return;
        }
        logger.debug({ telnyxMsg: parsed }, '[test-sim] WS -> Telnyx');
      } catch {
        logger.debug({ raw: data }, '[test-sim] WS -> Telnyx (raw)');
      }
    },
    close: () => {
      // noop
    },
    on: () => {
      // noop
    },
  } as unknown as WebSocket;
  return ws;
}

/**
 * Routes de test pour simuler un appel vocal sans Telnyx ni providers audio.
 *
 * Usage :
 *   curl -X POST http://localhost:4000/api/test/simulate-call \
 *     -H 'Content-Type: application/json' \
 *     -d '{"callerPhone": "+336****5678", "mode": "mock"}'
 */
export async function testRoutes(app: FastifyInstance) {
  app.post('/api/test/simulate-call', async (req, reply) => {
    const body = SimulateCallSchema.parse(req.body);
    const { callerPhone, restaurantPhone, mode } = body;

    const phone = restaurantPhone ?? '+331****0405';
    const restaurant = await db.restaurant.findUnique({
      where: { phoneNumber: phone },
      include: { personality: true },
    });

    if (!restaurant) {
      return reply.status(404).send({ error: 'Restaurant not found', phone });
    }

    const ctx = await RestaurantService.loadContext(phone);
    const safe = await RestaurantService.checkMarginHealth(ctx.id);
    if (!safe) {
      return reply.status(429).send({ error: "Circuit breaker triggered — trop d'appels récents" });
    }

    const customer = await CustomerService.lookupOrCreate(ctx.id, callerPhone);
    const customerExtra = CustomerService.buildVipPromptExtra(customer);
    const systemPrompt = buildSystemPrompt({
      ...ctx,
      openingHours: ctx.openingHours as OpeningHours,
      customerExtra,
    });

    // Créer un Call record en DB
    const callControlId = `test-call-${Date.now()}`;
    const callSessionId = `test-session-${Date.now()}`;
    await db.call.create({
      data: {
        id: callControlId,
        callSid: callControlId,
        restaurantId: ctx.id,
        carrier: 'test-simulation',
        sttProvider: 'test',
        llmProvider: mode,
        ttsProvider: 'test',
      },
    });

    // Créer la session en mémoire
    const mgr = CallSessionManager.getInstance();
    mgr.create({
      callControlId,
      callSessionId,
      from: callerPhone,
      to: phone,
      restaurantId: ctx.id,
      systemPrompt,
      isVip: customer?.isVip ?? false,
      telnyxWs: createFakeTelnyxWs(),
      callLegId: callControlId,
      codec: 'PCMU',
      personality: restaurant.personality
        ? {
            fillerStyle: restaurant.personality.fillerStyle,
            systemPromptExtra: restaurant.personality.systemPromptExtra,
          }
        : null,
    });

    // En mode mock, on active le flag interne sans toucher à la clé réelle.
    if (mode === 'mock') {
      process.env.SOKAR_SIMULATE_MOCK_LLM = 'true';
    }

    return reply.send({
      test: true,
      mode,
      callControlId,
      restaurant: { id: ctx.id, name: ctx.name, plan: ctx.plan },
      caller: { phone: callerPhone, name: customer?.name ?? null, isVip: customer?.isVip ?? false },
      nextStep: 'POST /api/test/simulate-utterance with { callControlId, transcript }',
    });
  });

  app.post('/api/test/simulate-utterance', async (req, reply) => {
    const body = SimulateUtteranceSchema.parse(req.body);
    const mgr = CallSessionManager.getInstance();

    try {
      const response = await mgr.simulateUtterance(body.callControlId, body.transcript);
      return reply.send({
        ok: true,
        transcript: body.transcript,
        response,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ ok: false, error: message });
    }
  });

  /**
   * GET /api/test/simulate-call/:callControlId/reservations
   * Vérifier les réservations créées pendant un appel simulé.
   */
  app.get('/api/test/simulate-call/:callControlId/reservations', async (req, reply) => {
    const { callControlId } = req.params as { callControlId: string };
    const reservations = await db.reservation.findMany({
      where: { callId: callControlId },
      orderBy: { createdAt: 'desc' },
    });
    return reply.send(reservations);
  });

  /**
   * GET /api/test/restaurants — lister les restaurants test créés
   */
  app.get('/api/test/restaurants', async (_req, reply) => {
    const restaurants = await db.restaurant.findMany({
      where: { id: { startsWith: 'test-' } },
      include: { personality: true, _count: { select: { calls: true, reservations: true } } },
    });
    return reply.send(restaurants);
  });

  /**
   * DELETE /api/test/restaurants — nettoyer les restaurants test
   */
  app.delete('/api/test/restaurants', async (_req, reply) => {
    const result = await db.restaurant.deleteMany({
      where: { id: { startsWith: 'test-' } },
    });
    return reply.send({ deleted: result.count });
  });
}
