import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Prisma, GiftCard, GiftCardRedemption } from '@prisma/client';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { GiftCardService } from './gift-card.service';
import { recommendGiftCardAmount } from './gift-card-recommender';

const ListGiftCardsQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'REDEEMED', 'EXPIRED', 'CANCELLED']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
});

const CreateGiftCardSchema = z.object({
  amount: z.coerce.number().positive(),
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

const PurchaseGiftCardSchema = z.object({
  restaurantId: z.string(),
  amount: z.coerce.number().positive(),
  occasion: z.string().max(100).optional(),
  senderName: z.string().min(1).max(100).optional(),
  senderEmail: z.string().email().max(255).optional(),
  senderPhone: z.string().max(50).optional(),
  recipientName: z.string().min(1).max(100).optional(),
  recipientEmail: z.string().email().max(255).optional(),
  recipientPhone: z.string().max(50).optional(),
  message: z.string().max(1000).optional(),
  purchaseReference: z.string().max(255).optional(),
});

const ApplyGiftCardSchema = z.object({
  code: z.string().min(1),
  restaurantId: z.string(),
  reservationId: z.string(),
  reservationAmount: z.coerce.number().positive(),
});

function maskCode(code: string): string {
  if (code.length <= 8) {
    return '****' + code.slice(-4);
  }
  return code.slice(0, 4) + '-****-****-' + code.slice(-4);
}

function serializeGiftCard(card: GiftCard & { redemptions?: GiftCardRedemption[] }) {
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
    senderName: card.senderName,
    senderEmail: card.senderEmail,
    senderPhone: card.senderPhone,
    recipientName: card.recipientName,
    recipientEmail: card.recipientEmail,
    recipientPhone: card.recipientPhone,
    message: card.message,
    voiceMessageUrl: card.voiceMessageUrl,
    occasion: card.occasion,
    customerId: card.customerId,
    createdBy: card.createdBy,
    purchaseReference: card.purchaseReference,
  };
}

export async function giftCardRoutes(app: FastifyInstance): Promise<void> {
  const service = new GiftCardService(db);

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
        include: { redemptions: { orderBy: { redeemedAt: 'desc' } } },
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
        include: { redemptions: { orderBy: { redeemedAt: 'desc' } } },
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
        include: { redemptions: { orderBy: { redeemedAt: 'desc' } } },
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

  app.post('/public/gift-cards/purchase', async (req, reply) => {
    const body = PurchaseGiftCardSchema.parse(req.body);
    const card = await service.create({
      restaurantId: body.restaurantId,
      amount: body.amount,
      occasion: body.occasion,
      senderName: body.senderName,
      senderEmail: body.senderEmail,
      senderPhone: body.senderPhone,
      recipientName: body.recipientName,
      recipientEmail: body.recipientEmail,
      recipientPhone: body.recipientPhone,
      message: body.message,
      createdBy: 'CLIENT',
      purchaseReference: body.purchaseReference ?? 'test',
    });

    return reply.status(201).send(serializeGiftCard(card));
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
}
