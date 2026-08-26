import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import {
  BILLING_INTERVALS,
  BillingAlreadySubscribedError,
  BillingCheckoutError,
  BillingNotConfiguredError,
  BillingRestaurantNotFoundError,
  PUBLIC_BILLING_PLANS,
  createCheckoutSession,
} from './billing.service';

const CheckoutSchema = z.object({
  plan: z.enum(PUBLIC_BILLING_PLANS),
  billing: z.enum(BILLING_INTERVALS),
});

export async function billingRoutes(app: FastifyInstance) {
  app.post('/billing/checkout-session', { preHandler: requireOrg() }, async (req, reply) => {
    const input = CheckoutSchema.parse(req.body);

    try {
      const session = await createCheckoutSession({
        restaurantId: req.restaurantId!,
        plan: input.plan,
        billing: input.billing,
      });
      return reply.send(session);
    } catch (error) {
      if (error instanceof BillingNotConfiguredError) {
        return reply.status(503).send({
          error: 'BILLING_NOT_CONFIGURED',
          message: 'La souscription en ligne sera bientôt disponible.',
        });
      }
      if (error instanceof BillingRestaurantNotFoundError) {
        return reply
          .status(404)
          .send({ error: 'RESTAURANT_NOT_FOUND', message: 'Restaurant introuvable.' });
      }
      if (error instanceof BillingAlreadySubscribedError) {
        return reply.status(409).send({
          error: 'BILLING_ALREADY_SUBSCRIBED',
          message: 'Une souscription est déjà active pour ce restaurant.',
        });
      }
      if (error instanceof BillingCheckoutError) {
        return reply.status(502).send({
          error: 'BILLING_CHECKOUT_FAILED',
          message: 'Impossible de préparer la souscription. Réessayez dans un instant.',
        });
      }

      req.log.error(
        { err: error instanceof Error ? error.message : String(error) },
        '[billing] Unexpected checkout error',
      );
      return reply.status(502).send({
        error: 'BILLING_CHECKOUT_FAILED',
        message: 'Impossible de préparer la souscription. Réessayez dans un instant.',
      });
    }
  });
}
