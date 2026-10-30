import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clerkClient } from '@clerk/fastify';
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
  BillingTrialAlreadyUsedError,
  PUBLIC_BILLING_PLANS,
  createBillingPortalSession,
  createCheckoutSession,
  getBillingStatus,
  getBillingDetails,
  startTrial,
} from './billing.service';

const TrialSchema = z
  .object({
    plan: z.enum(PUBLIC_BILLING_PLANS).optional(),
    billing: z.enum(BILLING_INTERVALS).optional(),
    siteCount: z.number().int().min(1).max(100).optional(),
  })
  .default({});

const CheckoutSchema = z.object({
  plan: z.enum(PUBLIC_BILLING_PLANS),
  billing: z.enum(BILLING_INTERVALS),
  siteCount: z.number().int().min(1).max(100).optional(),
  // Où Stripe ramène le restaurateur : les Réglages (défaut) ou l'inscription en cours, dont
  // l'espace n'est pas encore ouvert.
  returnTo: z.enum(['settings', 'onboarding', 'billing']).optional(),
});

const PortalSchema = z
  .object({
    intent: z
      .enum(['manage', 'payment_method', 'subscription_update', 'subscription_cancel'])
      .optional(),
    returnTo: z.enum(['settings', 'billing']).optional(),
  })
  .strict();

export async function billingRoutes(app: FastifyInstance) {
  async function requireBillingOwner(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    if (req.siteRole === 'OWNER') return true;
    if (!req.accountId && req.siteRole === 'ORG_MEMBER' && req.userId && req.clerkOrganizationId) {
      try {
        const organization = await clerkClient.organizations.getOrganization({
          organizationId: req.clerkOrganizationId,
        });
        if (organization.createdBy === req.userId) return true;
      } catch {
        reply.status(503).send({
          error: 'OWNER_VERIFICATION_UNAVAILABLE',
          message: 'Impossible de vérifier le propriétaire pour le moment.',
        });
        return false;
      }
    }
    reply.status(403).send({
      error: 'BILLING_OWNER_REQUIRED',
      message: 'Seul le propriétaire du compte peut gérer la facturation.',
    });
    return false;
  }
  app.get('/billing/status', { preHandler: requireOrg() }, async (req, reply) => {
    try {
      return reply.send(
        await getBillingStatus({
          restaurantId: req.restaurantId!,
          accountId: req.accountId,
          includeTrialRecap: true,
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

  app.get('/billing/details', { preHandler: requireOrg() }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!(await requireBillingOwner(req, reply))) return;
    try {
      return reply.send(
        await getBillingDetails({ restaurantId: req.restaurantId!, accountId: req.accountId }),
      );
    } catch (error) {
      if (error instanceof BillingRestaurantNotFoundError)
        return reply
          .status(404)
          .send({ error: 'RESTAURANT_NOT_FOUND', message: 'Restaurant introuvable.' });
      req.log.warn('[billing] Billing details unavailable');
      return reply.status(502).send({
        error: 'BILLING_DETAILS_FAILED',
        message: 'Impossible de charger les informations Stripe. Réessayez dans un instant.',
      });
    }
  });

  app.post('/billing/checkout-session', { preHandler: requireOrg() }, async (req, reply) => {
    if (!(await requireBillingOwner(req, reply))) return;
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
        returnTo: input.returnTo,
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
          message: 'Choisissez entre 1 et 100 établissements pour la formule Multi-restaurant.',
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

  // Onboarding : essai gratuit sur la formule choisie, sans passer par Stripe Checkout.
  app.post('/billing/trial', { preHandler: requireOrg() }, async (req, reply) => {
    if (!(await requireBillingOwner(req, reply))) return;
    try {
      return reply.send(
        await startTrial({
          restaurantId: req.restaurantId!,
          accountId: req.accountId,
          ...TrialSchema.parse(req.body ?? {}),
        }),
      );
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
          message: 'Choisissez entre 1 et 100 établissements pour la formule Multi-restaurant.',
        });
      }
      if (error instanceof BillingTrialAlreadyUsedError) {
        return reply.status(409).send({
          error: 'BILLING_TRIAL_ALREADY_USED',
          message: 'L’essai gratuit a déjà été utilisé : choisissez une formule pour continuer.',
        });
      }
      req.log.error(
        { err: error instanceof Error ? error.message : String(error) },
        '[billing] Unexpected trial error',
      );
      return reply.status(502).send({
        error: 'BILLING_TRIAL_FAILED',
        message: 'Impossible de démarrer l’essai. Réessayez dans un instant.',
      });
    }
  });

  app.post('/billing/portal-session', { preHandler: requireOrg() }, async (req, reply) => {
    if (!(await requireBillingOwner(req, reply))) return;

    const input = PortalSchema.parse(req.body ?? {});
    reply.header('Cache-Control', 'no-store');
    try {
      return reply.send(
        await createBillingPortalSession({
          restaurantId: req.restaurantId!,
          accountId: req.accountId,
          ...input,
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
