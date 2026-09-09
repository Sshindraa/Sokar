import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import {
  BILLING_INTERVALS,
  BillingAlreadySubscribedError,
  BillingCheckoutError,
  BillingInvalidSiteCountError,
  BillingNotConfiguredError,
  BillingCustomerNotFoundError,
  BillingRestaurantNotFoundError,
  PUBLIC_BILLING_PLANS,
  createBillingPortalSession,
  createCheckoutSession,
  getBillingStatus,
} from './billing.service';

const CheckoutSchema = z.object({
  plan: z.enum(PUBLIC_BILLING_PLANS),
  billing: z.enum(BILLING_INTERVALS),
  siteCount: z.number().int().min(2).max(100).optional(),
});

export async function billingRoutes(app: FastifyInstance) {
  app.get('/billing/status', { preHandler: requireOrg() }, async (req, reply) => {
    try {
      return reply.send(
        await getBillingStatus({
          restaurantId: req.restaurantId!,
          accountId: req.accountId,
        }),
      );
    } catch (error) {
      if (error instanceof BillingRestaurantNotFoundError) {
        return reply
          .status(404)
          .send({ error: 'RESTAURANT_NOT_FOUND', message: 'Restaurant introuvable.' });
      }

      req.log.error(
        { err: error instanceof Error ? error.message : String(error) },
        '[billing] Unexpected status error',
      );
      return reply.status(500).send({
        error: 'BILLING_STATUS_FAILED',
        message: 'Impossible de charger le statut de la facturation.',
      });
    }
  });

  app.post('/billing/checkout-session', { preHandler: requireOrg() }, async (req, reply) => {
    if (req.accountId && req.siteRole !== 'OWNER') {
      return reply.status(403).send({
        error: 'BILLING_OWNER_REQUIRED',
        message: 'Seul le propriétaire du compte peut gérer la facturation.',
      });
    }
    const input = CheckoutSchema.parse(req.body);
    const idempotencyHeader = req.headers['idempotency-key'];
    const idempotencyKey = Array.isArray(idempotencyHeader)
      ? idempotencyHeader[0]
      : idempotencyHeader;

    try {
      const session = await createCheckoutSession({
        restaurantId: req.restaurantId!,
        accountId: req.accountId,
        plan: input.plan,
        billing: input.billing,
        siteCount: input.siteCount,
        idempotencyKey,
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
      if (error instanceof BillingInvalidSiteCountError) {
        return reply.status(400).send({
          error: 'INVALID_SITE_COUNT',
          message: 'Choisissez entre 2 et 100 établissements pour la formule Multi-site.',
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

  app.post('/billing/portal-session', { preHandler: requireOrg() }, async (req, reply) => {
    if (req.accountId && req.siteRole !== 'OWNER') {
      return reply.status(403).send({
        error: 'BILLING_OWNER_REQUIRED',
        message: 'Seul le propriétaire du compte peut gérer la facturation.',
      });
    }

    try {
      return reply.send(
        await createBillingPortalSession({
          restaurantId: req.restaurantId!,
          accountId: req.accountId,
        }),
      );
    } catch (error) {
      if (error instanceof BillingNotConfiguredError) {
        return reply.status(503).send({
          error: 'BILLING_NOT_CONFIGURED',
          message: 'La gestion de votre abonnement sera bientôt disponible.',
        });
      }
      if (error instanceof BillingRestaurantNotFoundError) {
        return reply
          .status(404)
          .send({ error: 'RESTAURANT_NOT_FOUND', message: 'Restaurant introuvable.' });
      }
      if (error instanceof BillingCustomerNotFoundError) {
        return reply.status(409).send({
          error: 'BILLING_CUSTOMER_NOT_FOUND',
          message: 'Aucune souscription Stripe active pour ce compte.',
        });
      }
      if (error instanceof BillingCheckoutError) {
        return reply.status(502).send({
          error: 'BILLING_PORTAL_FAILED',
          message: 'Impossible d’ouvrir la gestion de l’abonnement. Réessayez dans un instant.',
        });
      }

      req.log.error(
        { err: error instanceof Error ? error.message : String(error) },
        '[billing] Unexpected portal error',
      );
      return reply.status(502).send({
        error: 'BILLING_PORTAL_FAILED',
        message: 'Impossible d’ouvrir la gestion de l’abonnement. Réessayez dans un instant.',
      });
    }
  });
}
