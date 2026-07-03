import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, GiftCard, GiftCardRedemption } from '@prisma/client';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { GiftCardService } from './gift-card.service';
import { GiftCardSlotsService } from './gift-card-slots.service';
import { GiftCardBookService } from './gift-card-book.service';
import { recommendGiftCardAmount } from './gift-card-recommender';
import { createPaymentIntent, constructWebhookEvent } from './stripe.service';
import { GiftCardPaymentService } from './gift-card-payment.service';
import { generateGiftCardPdf } from './gift-card-pdf.service';
import { logger } from '../../shared/logger/pino';

const ListGiftCardsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
});

const CreateGiftCardSchema = z
  .object({
    amount: z.coerce.number().positive().optional(),
    packId: z.string().optional(),
    recipientName: z.string().min(1).max(100).optional(),
    recipientEmail: z.string().email().max(255).optional(),
    recipientPhone: z.string().max(50).optional(),
    senderName: z.string().min(1).max(100).optional(),
    message: z.string().max(1000).optional(),
    occasion: z.string().max(100).optional(),
    preferredDate: z.coerce.date().optional(),
    preferredTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    preferredPartySize: z.coerce.number().int().min(1).optional(),
    expiresAt: z.coerce
      .date()
      .optional()
      .refine((date) => !date || date > new Date(), {
        message: "La date d'expiration doit être dans le futur",
      }),
  })
  .refine((data) => data.amount || data.packId, {
    message: 'Le montant ou le pack est requis',
  });

const UpdateGiftCardSchema = z.object({
  recipientName: z.string().min(1).max(100).optional(),
  recipientEmail: z.string().email().max(255).optional(),
  recipientPhone: z.string().max(50).optional(),
  senderName: z.string().min(1).max(100).optional(),
  message: z.string().max(1000).optional(),
  occasion: z.string().max(100).optional(),
  expiresAt: z.coerce
    .date()
    .optional()
    .refine((date) => !date || date > new Date(), {
      message: "La date d'expiration doit être dans le futur",
    }),
});

const CheckGiftCardSchema = z.object({
  code: z.string().min(1),
});

const RecommendGiftCardSchema = z.object({
  restaurantId: z.string().optional(),
  priceRange: z.string().optional(),
  occasion: z.string().optional(),
  partySize: z.coerce.number().int().min(1).optional(),
  budget: z.coerce.number().positive().optional(),
});

const PaymentIntentSchema = z.object({
  restaurantId: z.string(),
  amount: z.coerce.number().positive(),
  packId: z.string().optional(),
});

const PurchaseWithPaymentSchema = z
  .object({
    restaurantId: z.string(),
    paymentIntentId: z.string().min(1),
    amount: z.coerce.number().positive().optional(),
    packId: z.string().optional(),
    occasion: z.string().max(100).optional(),
    senderName: z.string().min(1).max(100).optional(),
    senderEmail: z.string().email().max(255).optional(),
    senderPhone: z.string().max(50).optional(),
    recipientName: z.string().min(1).max(100).optional(),
    recipientEmail: z.string().email().max(255).optional(),
    recipientPhone: z.string().max(50).optional(),
    message: z.string().max(1000).optional(),
    templateId: z.string().max(100).optional(),
    customImageUrl: z.string().url().max(1000).optional(),
    preferredDate: z.coerce.date().optional(),
    preferredTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .optional(),
    preferredPartySize: z.coerce.number().int().min(1).optional(),
  })
  .refine((data) => data.amount || data.packId, {
    message: 'Le montant ou le pack est requis',
  });

const ApplyGiftCardSchema = z.object({
  code: z.string().min(1),
  restaurantId: z.string(),
  reservationId: z.string(),
  reservationAmount: z.coerce.number().positive(),
});

const SuggestSlotsSchema = z.object({
  partySize: z.coerce.number().int().min(1).optional(),
  preferredDate: z.coerce.date().optional(),
  preferredTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .optional(),
});

const BookSlotSchema = z.object({
  slotIndex: z.coerce.number().int().min(0).max(2),
  customer: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164 (e.g. +33612345678)'),
    email: z.string().email().optional().or(z.literal('')),
  }),
});

function maskCode(code: string): string {
  if (code.length <= 8) {
    return '****' + code.slice(-4);
  }
  return code.slice(0, 4) + '-****-****-' + code.slice(-4);
}

function serializeGiftCard(
  card: GiftCard & { redemptions?: GiftCardRedemption[]; pack?: { name: string } | null },
) {
  return {
    id: card.id,
    restaurantId: card.restaurantId,
    code: maskCode(card.code),
    amount: card.amount.toNumber(),
    remainingAmount: card.remainingAmount.toNumber(),
    currency: card.currency,
    status: card.status,
    purchasedAt: card.purchasedAt,
    expiresAt: card.expiresAt,
    validityMonths: card.validityMonths,
    packId: card.packId,
    packName: card.pack?.name ?? null,
    preferredDate: card.preferredDate,
    preferredTime: card.preferredTime,
    preferredPartySize: card.preferredPartySize,
    senderName: card.senderName,
    senderEmail: card.senderEmail,
    senderPhone: card.senderPhone,
    recipientName: card.recipientName,
    recipientEmail: card.recipientEmail,
    recipientPhone: card.recipientPhone,
    message: card.message,
    occasion: card.occasion,
    customerId: card.customerId,
    createdBy: card.createdBy,
    purchaseReference: card.purchaseReference,
    stripePaymentStatus: card.stripePaymentStatus,
    templateId: card.templateId,
    sokarCommissionAmount: card.sokarCommissionAmount?.toNumber() ?? 0,
  };
}

export async function giftCardRoutes(app: FastifyInstance): Promise<void> {
  const service = new GiftCardService(db);
  const slotsService = new GiftCardSlotsService(db);
  const bookService = new GiftCardBookService(db, slotsService);

  // ─── Admin routes ─────────────────────────────────────────────────

  app.get('/restaurants/:id/gift-cards', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const query = ListGiftCardsQuerySchema.parse(req.query);
    const where: Prisma.GiftCardWhereInput = { restaurantId };
    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.OR = [
        { recipientEmail: { contains: query.search, mode: 'insensitive' } },
        { recipientName: { contains: query.search, mode: 'insensitive' } },
        { senderName: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [items, total] = await Promise.all([
      db.giftCard.findMany({
        where,
        skip: query.offset,
        take: query.limit,
        orderBy: { purchasedAt: 'desc' },
        include: { redemptions: { orderBy: { redeemedAt: 'desc' } }, pack: true },
      }),
      db.giftCard.count({ where: { restaurantId } }),
    ]);

    return reply.send({
      items: items.map(serializeGiftCard),
      total,
      limit: query.limit,
      offset: query.offset,
    });
  });

  app.post('/restaurants/:id/gift-cards', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const body = CreateGiftCardSchema.parse(req.body);
    const card = await service.create({
      ...body,
      restaurantId,
      createdBy: 'DASHBOARD',
    });

    return reply.status(201).send(serializeGiftCard(card));
  });

  app.get(
    '/restaurants/:id/gift-cards/:giftCardId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, giftCardId } = req.params as { id: string; giftCardId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const card = await db.giftCard.findFirst({
        where: { id: giftCardId, restaurantId },
        include: { redemptions: { orderBy: { redeemedAt: 'desc' } }, pack: true },
      });

      if (!card) {
        return reply.status(404).send({ error: 'Carte cadeau introuvable' });
      }

      return reply.send(serializeGiftCard(card));
    },
  );

  app.patch(
    '/restaurants/:id/gift-cards/:giftCardId',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, giftCardId } = req.params as { id: string; giftCardId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const existing = await db.giftCard.findFirst({
        where: { id: giftCardId, restaurantId },
      });
      if (!existing) {
        return reply.status(404).send({ error: 'Carte cadeau introuvable' });
      }

      const body = UpdateGiftCardSchema.parse(req.body);
      const card = await db.giftCard.update({
        where: { id: giftCardId },
        data: {
          ...(body.recipientName !== undefined && { recipientName: body.recipientName }),
          ...(body.recipientEmail !== undefined && { recipientEmail: body.recipientEmail }),
          ...(body.recipientPhone !== undefined && { recipientPhone: body.recipientPhone }),
          ...(body.senderName !== undefined && { senderName: body.senderName }),
          ...(body.message !== undefined && { message: body.message }),
          ...(body.occasion !== undefined && { occasion: body.occasion }),
          ...(body.expiresAt !== undefined && { expiresAt: body.expiresAt }),
        },
        include: { redemptions: { orderBy: { redeemedAt: 'desc' } }, pack: true },
      });

      return reply.send(serializeGiftCard(card));
    },
  );

  app.post(
    '/restaurants/:id/gift-cards/:giftCardId/cancel',
    { preHandler: requireOrg() },
    async (req, reply) => {
      const { id: restaurantId, giftCardId } = req.params as { id: string; giftCardId: string };
      if (restaurantId !== req.restaurantId) {
        return reply.status(403).send({ error: 'Accès refusé' });
      }

      const card = await service.cancel(giftCardId, restaurantId);
      return reply.send(serializeGiftCard(card));
    },
  );

  app.get('/restaurants/:id/gift-cards/stats', { preHandler: requireOrg() }, async (req, reply) => {
    const restaurantId = (req.params as { id: string }).id;
    if (restaurantId !== req.restaurantId) {
      return reply.status(403).send({ error: 'Accès refusé' });
    }

    const stats = await service.getStats(restaurantId);
    return reply.send(stats);
  });

  // ─── Public routes ────────────────────────────────────────────────

  app.get('/public/gift-cards/packs/:slug', async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const restaurant = await db.restaurant.findFirst({
      where: { slug },
      select: { id: true },
    });
    if (!restaurant) {
      return reply.status(404).send({ error: 'Restaurant introuvable' });
    }

    const packs = await db.giftCardPack.findMany({
      where: { restaurantId: restaurant.id, isActive: true },
      orderBy: { amount: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        amount: true,
        minPartySize: true,
        maxPartySize: true,
      },
    });

    return reply.send(packs.map((p) => ({ ...p, amount: p.amount.toNumber() })));
  });

  app.post('/public/gift-cards/check', async (req, reply) => {
    const body = CheckGiftCardSchema.parse(req.body);
    const result = await service.validateCode(body.code);

    if (!result.valid) {
      return reply.send({ valid: false });
    }

    const card = result.giftCard;
    const restaurant = await db.restaurant.findUnique({
      where: { id: card.restaurantId },
      select: { name: true },
    });

    return reply.send({
      valid: true,
      giftCard: {
        amount: card.amount.toNumber(),
        remainingAmount: card.remainingAmount.toNumber(),
        status: card.status,
        expiresAt: card.expiresAt,
        restaurantName: restaurant?.name ?? null,
      },
    });
  });

  app.post('/public/gift-cards/recommend', async (req, reply) => {
    const body = RecommendGiftCardSchema.parse(req.body);
    const recommendation = recommendGiftCardAmount({
      priceRange: body.priceRange,
      occasion: body.occasion,
      partySize: body.partySize,
      budget: body.budget,
    });

    return reply.send(recommendation);
  });

  app.post('/public/gift-cards/apply', async (req, reply) => {
    const body = ApplyGiftCardSchema.parse(req.body);
    const result = await service.applyToReservation({
      code: body.code,
      restaurantId: body.restaurantId,
      reservationId: body.reservationId,
      reservationAmount: body.reservationAmount,
    });

    return reply.send(result);
  });

  app.post('/public/gift-cards/:code/slots', async (req, reply) => {
    const code = (req.params as { code: string }).code;
    const body = SuggestSlotsSchema.parse(req.body);

    const slots = await slotsService.suggestSlots({
      giftCardCode: code,
      partySize: body.partySize,
      preferredDate: body.preferredDate,
      preferredTime: body.preferredTime,
    });

    return reply.send({ slots });
  });

  app.post('/public/gift-cards/:code/book', async (req, reply) => {
    const code = (req.params as { code: string }).code;
    const body = BookSlotSchema.parse(req.body);

    const result = await bookService.book({
      code,
      slotIndex: body.slotIndex,
      customer: body.customer,
    });

    return reply.send({
      reservationId: result.reservationId,
      status: 'confirmed',
      state: result.state,
      giftCardApplication: result.giftCardApplication,
    });
  });

  // ─── P2 — Stripe Payment Intent ──────────────────────────────────
  app.post('/public/gift-cards/payment-intent', async (req, reply) => {
    const body = PaymentIntentSchema.parse(req.body);

    // Déterminer le montant (pack ou libre)
    let amount: number;
    if (body.packId) {
      const pack = await db.giftCardPack.findFirst({
        where: { id: body.packId, restaurantId: body.restaurantId, isActive: true },
        select: { amount: true },
      });
      if (!pack) {
        return reply.status(404).send({ error: 'Pack cadeau introuvable' });
      }
      amount = pack.amount.toNumber();
    } else {
      amount = body.amount;
    }

    // Vérifier le montant minimum
    const restaurant = await db.restaurant.findUnique({
      where: { id: body.restaurantId },
      select: { giftCardMinimumAmount: true },
    });
    const minAmount = restaurant?.giftCardMinimumAmount ?? 10;
    if (amount < minAmount) {
      return reply.status(400).send({ error: `Le montant minimum est de ${minAmount}€` });
    }

    try {
      const intent = await createPaymentIntent({
        amount: Math.round(amount * 100), // centimes
        currency: 'eur',
        metadata: {
          restaurantId: body.restaurantId,
          packId: body.packId ?? '',
          amount: String(amount),
        },
      });

      return reply.send({
        paymentIntentId: intent.id,
        clientSecret: intent.clientSecret,
      });
    } catch (err: unknown) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[gift-card-routes] Failed to create payment intent',
      );
      return reply.status(500).send({ error: 'Impossible de créer le paiement' });
    }
  });

  // ─── P2 — Purchase with payment ──────────────────────────────────
  app.post('/public/gift-cards/purchase', async (req, reply) => {
    const body = PurchaseWithPaymentSchema.parse(req.body);
    const paymentService = new GiftCardPaymentService(db);

    try {
      const card = await paymentService.purchaseWithPayment({
        restaurantId: body.restaurantId,
        paymentIntentId: body.paymentIntentId,
        amount: body.amount,
        packId: body.packId,
        occasion: body.occasion,
        senderName: body.senderName,
        senderEmail: body.senderEmail,
        senderPhone: body.senderPhone,
        recipientName: body.recipientName,
        recipientEmail: body.recipientEmail,
        recipientPhone: body.recipientPhone,
        message: body.message,
        templateId: body.templateId,
        customImageUrl: body.customImageUrl,
        preferredDate: body.preferredDate,
        preferredTime: body.preferredTime,
        preferredPartySize: body.preferredPartySize,
      });

      const pack = card.packId
        ? await db.giftCardPack.findUnique({ where: { id: card.packId }, select: { name: true } })
        : null;

      return reply.status(201).send({
        id: card.id,
        code: card.code,
        amount: card.amount.toNumber(),
        remainingAmount: card.remainingAmount.toNumber(),
        status: card.status,
        packName: pack?.name ?? null,
        preferredDate: card.preferredDate,
        preferredTime: card.preferredTime,
        preferredPartySize: card.preferredPartySize,
        stripePaymentStatus: card.stripePaymentStatus,
        pdfUrl: `${process.env.API_URL ?? ''}/public/gift-cards/${card.code}/pdf`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message }, '[gift-card-routes] Purchase with payment failed');
      return reply.status(400).send({ error: message });
    }
  });

  // ─── P2 — PDF download ───────────────────────────────────────────
  app.get('/public/gift-cards/:code/pdf', async (req, reply) => {
    const code = (req.params as { code: string }).code;

    const card = await db.giftCard.findUnique({
      where: { code },
      include: { restaurant: { select: { name: true } }, pack: { select: { name: true } } },
    });

    if (!card) {
      return reply.status(404).send({ error: 'Carte cadeau introuvable' });
    }

    if (card.status === 'CANCELLED') {
      return reply.status(400).send({ error: 'Cette carte cadeau est annulée' });
    }

    try {
      const pdfBuffer = await generateGiftCardPdf(card);
      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="carte-cadeau-${card.code}.pdf"`);
      return reply.send(pdfBuffer);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        { err: errMsg, stack: err instanceof Error ? err.stack : undefined, code },
        '[gift-card-routes] PDF generation failed',
      );
      return reply.status(500).send({ error: 'Impossible de générer le PDF' });
    }
  });

  // ─── P2 — Stripe webhook ─────────────────────────────────────────
  app.post('/webhooks/stripe', async (req, reply) => {
    const signature = req.headers['stripe-signature'] as string | undefined;
    if (!signature) {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    const rawBody = (req as { rawBody?: string }).rawBody;
    if (!rawBody) {
      return reply.status(400).send({ error: 'Missing raw body' });
    }

    try {
      const event = await constructWebhookEvent(rawBody, signature);

      if (event.type === 'payment_intent.succeeded') {
        const pi = event.data.object as { id: string; metadata?: Record<string, string> };
        const paymentService = new GiftCardPaymentService(db);
        await paymentService.handleStripeWebhook(pi.id, pi.metadata ?? {});
      }

      return reply.send({ received: true });
    } catch (err: unknown) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        '[gift-card-routes] Stripe webhook verification failed',
      );
      return reply.status(400).send({ error: 'Webhook signature verification failed' });
    }
  });
}
