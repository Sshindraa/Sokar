import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ReservationPaymentStatus, ReservationPaymentType } from '@prisma/client';
import { db } from '../../shared/db/client';
import { requireOrg, requireSokarOperator } from '../../plugins/clerk';
import { requireCapability } from '../entitlements/entitlement.guard';
import { constructWebhookEvent } from '../gift-cards/stripe.service';
import { checkRateLimit, getClientIp, rateLimitKey } from '../../shared/redis/rate-limit';
import { RATE_LIMIT_PROVIDER_WEBHOOK } from '../../plugins/rate-limit.policy';
import {
  PAYMENT_AMOUNT_MODES,
  ReservationPaymentInputError,
  ReservationPaymentNotFoundError,
  ReservationPaymentPolicyNotFoundError,
  ReservationPaymentReservationNotFoundError,
  ReservationPaymentStateError,
  applyReservationPaymentProviderEvent,
  createReservationPaymentPolicy,
  expireReservationPayments,
  getReservationPayment,
  listReservationPaymentPolicies,
  prepareReservationPayment,
  transitionReservationPayment,
} from './reservation-payment.service';

const PolicyBodySchema = z.object({
  type: z.nativeEnum(ReservationPaymentType),
  amountMode: z.enum(PAYMENT_AMOUNT_MODES),
  amount: z.union([z.string().trim(), z.number().finite()]),
  minPartySize: z.number().int().min(1).max(100).nullable().optional(),
  cancellationHours: z.number().int().min(0).max(720).optional(),
  rules: z.record(z.unknown()).optional(),
  activeFrom: z.coerce.date().optional(),
  activeUntil: z.coerce.date().nullable().optional(),
  version: z.number().int().min(1).max(10_000).optional(),
});

const PrepareBodySchema = z.object({
  policyId: z.string().trim().min(1).max(128).optional(),
  idempotencyKey: z.string().trim().min(8).max(200),
  currency: z.string().trim().length(3).optional(),
  expiresAt: z.coerce.date().optional(),
  dryRun: z.boolean().default(true),
});

const ReservationParamsSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

const PaymentParamsSchema = z.object({
  paymentId: z.string().trim().min(1).max(128),
});

const WebhookMetadataSchema = z.object({
  restaurantId: z.string().trim().min(1).max(128),
  reservationPaymentId: z.string().trim().min(1).max(128),
});

function reservationPaymentsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  return environment.RESERVATION_PAYMENTS_ENABLED === 'true';
}

async function requireReservationPaymentFeature(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (reservationPaymentsEnabled()) return;
  return reply.status(503).send({
    error: 'RESERVATION_PAYMENTS_DISABLED',
    message: 'La protection bancaire reste désactivée jusqu’à la validation du pilote.',
  });
}

async function requirePaymentReadRole(
  request: { siteRole?: string },
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (
    request.siteRole === 'OWNER' ||
    request.siteRole === 'MANAGER' ||
    request.siteRole === 'STAFF'
  ) {
    return;
  }
  return reply.status(403).send({
    error: 'PAYMENT_ROLE_REQUIRED',
    message: 'La lecture de l’état de paiement est réservée à l’équipe du site.',
  });
}

async function requirePaymentWriteRole(
  request: { siteRole?: string },
  reply: FastifyReply,
): Promise<void | FastifyReply> {
  if (request.siteRole === 'OWNER' || request.siteRole === 'MANAGER') return;
  return reply.status(403).send({
    error: 'PAYMENT_ROLE_REQUIRED',
    message: 'La configuration des paiements est réservée aux responsables.',
  });
}

function sendPaymentError(error: unknown, reply: FastifyReply): FastifyReply | undefined {
  if (
    error instanceof ReservationPaymentPolicyNotFoundError ||
    error instanceof ReservationPaymentReservationNotFoundError ||
    error instanceof ReservationPaymentNotFoundError
  ) {
    return reply.status(404).send({ error: error.code });
  }
  if (error instanceof ReservationPaymentStateError) {
    return reply.status(409).send({ error: error.code });
  }
  if (error instanceof ReservationPaymentInputError) {
    return reply.status(400).send({ error: error.code, message: error.message });
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Routes for the local reservation-payment foundation. Provider calls are
 * intentionally absent; the prepare endpoint creates only an internal record
 * until a merchant model and a Stripe Connect pilot are approved. */
export async function reservationPaymentRoutes(app: FastifyInstance): Promise<void> {
  const paymentRead = [
    requireOrg(),
    requireCapability('reservations.payments'),
    requirePaymentReadRole,
    requireReservationPaymentFeature,
  ];
  const paymentWrite = [
    requireOrg(),
    requireCapability('reservations.payments'),
    requirePaymentWriteRole,
    requireReservationPaymentFeature,
  ];

  app.get('/reservation-payment-policies', { preHandler: paymentRead }, async (request, reply) => {
    return reply.send({ data: await listReservationPaymentPolicies(request.restaurantId) });
  });

  app.post(
    '/reservation-payment-policies',
    { preHandler: paymentWrite },
    async (request, reply) => {
      const body = PolicyBodySchema.parse(request.body);
      try {
        const policy = await createReservationPaymentPolicy({
          restaurantId: request.restaurantId,
          ...body,
        });
        return reply.status(201).send({ data: policy });
      } catch (error) {
        return sendPaymentError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.get('/reservations/:id/payment', { preHandler: paymentRead }, async (request, reply) => {
    const { id } = ReservationParamsSchema.parse(request.params);
    return reply.send({
      data: await getReservationPayment(request.restaurantId, id),
    });
  });

  app.post(
    '/reservations/:id/payment/prepare',
    { preHandler: paymentWrite },
    async (request, reply) => {
      const { id } = ReservationParamsSchema.parse(request.params);
      const body = PrepareBodySchema.parse(request.body);
      try {
        const result = await prepareReservationPayment({
          restaurantId: request.restaurantId,
          reservationId: id,
          ...body,
        });
        return reply.status(body.dryRun ? 200 : 201).send({ data: result });
      } catch (error) {
        return sendPaymentError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  app.post(
    '/reservations/:id/payment/expire',
    { preHandler: paymentWrite },
    async (request, reply) => {
      const { id } = ReservationParamsSchema.parse(request.params);
      try {
        const current = await getReservationPayment(request.restaurantId, id);
        if (!current) throw new ReservationPaymentNotFoundError();
        const result = await transitionReservationPayment({
          restaurantId: request.restaurantId,
          paymentId: current.id,
          to: ReservationPaymentStatus.EXPIRED,
        });
        return reply.send({ data: result });
      } catch (error) {
        return sendPaymentError(error, reply) ?? Promise.reject(error);
      }
    },
  );

  /** Operator-only maintenance endpoint used by the scheduled cleanup job.
   * It is intentionally tenant-agnostic and returns only a count. */
  app.post(
    '/api/internal/reservation-payments/expire',
    { preHandler: requireSokarOperator() },
    async (_request, reply) => {
      if (!reservationPaymentsEnabled()) {
        return reply.status(503).send({ error: 'RESERVATION_PAYMENTS_DISABLED' });
      }
      return reply.send({ expiredCount: await expireReservationPayments() });
    },
  );

  /** Stripe callback: verify the raw signature first, then persist only a
   * normalized event hash/status. Unknown event types are acknowledged and
   * recorded for audit without changing the payment. */
  // Provider tier: the global 100 req/min budget must not throttle Stripe.
  const stripeWebhookRouteOptions = {
    config: { rateLimit: RATE_LIMIT_PROVIDER_WEBHOOK },
  };
  app.post(
    '/webhooks/stripe/reservation-payments',
    stripeWebhookRouteOptions,
    async (request, reply) => {
      if (!reservationPaymentsEnabled()) {
        return reply.status(503).send({ error: 'RESERVATION_PAYMENTS_DISABLED' });
      }
      const ip = getClientIp(request);
      if (!(await checkRateLimit(rateLimitKey('reservation-payment-webhook', ip), 300))) {
        return reply.status(429).send({ error: 'RATE_LIMITED' });
      }
      const signatureHeader = request.headers['stripe-signature'];
      const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
      if (!signature) return reply.status(400).send({ error: 'MISSING_STRIPE_SIGNATURE' });
      const rawBody = (request as unknown as { rawBody?: unknown }).rawBody;
      if (typeof rawBody !== 'string')
        return reply.status(400).send({ error: 'RAW_BODY_REQUIRED' });

      let event: Awaited<ReturnType<typeof constructWebhookEvent>>;
      try {
        event = await constructWebhookEvent(rawBody, signature);
      } catch {
        return reply.status(400).send({ error: 'INVALID_STRIPE_SIGNATURE' });
      }

      const object = event.data.object as unknown as Record<string, unknown>;
      const metadataCandidate = object.metadata;
      const metadataParsed = WebhookMetadataSchema.safeParse(metadataCandidate);
      if (!metadataParsed.success) {
        return reply.status(400).send({ error: 'PAYMENT_METADATA_REQUIRED' });
      }
      const metadata = metadataParsed.data;
      if (
        metadata.restaurantId !== request.headers['x-sokar-restaurant-id'] &&
        request.headers['x-sokar-restaurant-id']
      ) {
        return reply.status(403).send({ error: 'PAYMENT_TENANT_MISMATCH' });
      }
      const amount = numberValue(object.amount_received) ?? numberValue(object.amount);
      const currency = stringValue(object.currency)?.toUpperCase();
      const occurredAt = new Date(event.created * 1000);
      const paymentIntentId = stringValue(object.payment_intent) ?? stringValue(object.id);
      const setupIntentId = event.type.startsWith('setup_intent.')
        ? stringValue(object.id)
        : undefined;
      const result = await applyReservationPaymentProviderEvent({
        restaurantId: metadata.restaurantId,
        paymentId: metadata.reservationPaymentId,
        providerEventId: event.id,
        eventType: event.type,
        occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
        payloadHash: createHash('sha256').update(rawBody).digest('hex'),
        ...(amount !== undefined ? { amount: amount / 100 } : {}),
        ...(currency ? { currency } : {}),
        ...(paymentIntentId && event.type.startsWith('payment_intent.')
          ? { stripePaymentIntentId: paymentIntentId }
          : {}),
        ...(setupIntentId ? { stripeSetupIntentId: setupIntentId } : {}),
        ...(event.type === 'payment_intent.payment_failed'
          ? { failureCode: stringValue(object.last_payment_error) ?? 'PAYMENT_FAILED' }
          : {}),
      });
      return reply.send({ received: true, ...result });
    },
  );

  app.get(
    '/reservation-payments/:paymentId',
    { preHandler: paymentRead },
    async (request, reply) => {
      const { paymentId } = PaymentParamsSchema.parse(request.params);
      try {
        const payment = await db.reservationPayment.findFirst({
          where: { id: paymentId, restaurantId: request.restaurantId },
          select: { id: true, reservationId: true },
        });
        if (!payment) throw new ReservationPaymentNotFoundError();
        const result = await getReservationPayment(request.restaurantId, payment.reservationId);
        return reply.send({ data: result });
      } catch (error) {
        return sendPaymentError(error, reply) ?? Promise.reject(error);
      }
    },
  );
}

export { reservationPaymentsEnabled };
