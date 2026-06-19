import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { RestaurantService } from '../restaurants/restaurant.service';
import { CustomerService } from '../customers/customer.service';
import { buildSystemPrompt } from '../voice/prompts';

const SimulateCallSchema = z.object({
  /** Ton numéro perso (l'appelant) */
  callerPhone: z.string().min(5),
  /** Optionnel : numéro du restaurant (si laissé vide, on crée un restaurant test) */
  restaurantPhone: z.string().min(5).optional(),
  /** Optionnel : nom du restaurant test */
  restaurantName: z.string().min(1).max(100).default('Mon Restaurant Test'),
});

/**
 * Route de test pour simuler un appel sans numéro Telnyx.
 *
 * Crée ou trouve un restaurant associé à restaurantPhone, puis exécute
 * la logique call.initiated du pipeline vocal (Media Stream).
 *
 * Usage :
 *   curl -X POST http://localhost:4000/api/test/simulate-call \
 *     -H 'Content-Type: application/json' \
 *     -d '{"callerPhone": "+33612345678", "restaurantName": "Chez Michel"}'
 */
export async function testRoutes(app: FastifyInstance) {
  app.post('/api/test/simulate-call', async (req, reply) => {
    const body = SimulateCallSchema.parse(req.body);
    const { callerPhone, restaurantPhone, restaurantName } = body;

    // 1. Trouver ou créer un restaurant test
    const phone = restaurantPhone ?? `+336****0000${Math.floor(Math.random() * 9000 + 1000)}`;
    let restaurant = await db.restaurant.findUnique({
      where: { phoneNumber: phone },
      include: { personality: true },
    });

    if (!restaurant) {
      restaurant = await db.restaurant.create({
        data: {
          id: `test-${Date.now()}`,
          name: restaurantName,
          phoneNumber: phone,
          managerPhone: callerPhone,
          managerEmail: 'test@sokar.fr',
          plan: 'STARTER',
          openingHours: {
            mon: { open: '09:00', close: '22:00' },
            tue: { open: '09:00', close: '22:00' },
            wed: { open: '09:00', close: '22:00' },
            thu: { open: '09:00', close: '22:00' },
            fri: { open: '09:00', close: '23:00' },
            sat: { open: '10:00', close: '23:00' },
            sun: null,
          },
        },
        include: { personality: true },
      });
      app.log.info({ restaurantId: restaurant.id }, 'Test restaurant created');
    }

    // 2. Simuler la logique call.initiated
    const ctx = await RestaurantService.loadContext(phone);
    const safe = await RestaurantService.checkMarginHealth(ctx.id);

    if (!safe) {
      return reply.send({ error: "Circuit breaker triggered — trop d'appels récents" });
    }

    const customer = callerPhone ? await CustomerService.lookupOrCreate(ctx.id, callerPhone) : null;

    const customerExtra = customer ? CustomerService.buildVipPromptExtra(customer) : '';

    const systemPrompt = buildSystemPrompt({ ...ctx, customerExtra });

    // 3. Retourner la config Media Stream
    const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
    const wsUrl = publicUrl.replace(/^https?/, 'wss') + `/voice/stream/test-${Date.now()}`;

    return reply.send({
      test: true,
      pipeline: 'media stream',
      restaurant: { id: ctx.id, name: ctx.name, plan: ctx.plan },
      caller: { phone: callerPhone, name: customer?.name ?? null, isVip: customer?.isVip ?? false },
      mediaStream: {
        stream_url: wsUrl,
        stream_track: 'inbound_track',
        stream_bidirectional_mode: 'rtp',
        stream_bidirectional_codec: 'L16',
      },
      systemPrompt: systemPrompt.slice(0, 500) + '…',
    });
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
