import {
  retryGiftCardDelivery,
  resendGiftCardRecipient,
  resolveGiftCardDelivery,
} from './gift-card-delivery-operations.service';
import { reconcileGiftCardDelivery } from './gift-card-delivery.service';
import { exportGiftCardLedger } from './gift-card-export.service';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { GiftCardOperationsService, GiftCardOperationError } from './gift-card-operations.service';
import { serializeGiftCard } from './gift-card.routes';

const debitSchema = z
  .object({
    billAmount: z
      .number()
      .positive()
      .max(999999.99)
      .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001, 'Deux décimales maximum.'),
    ticketReference: z.string().trim().min(1).max(64),
    reservationId: z.string().min(1).max(128).optional(),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

async function teamAccess(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.params as { id: string };
  if (id !== req.restaurantId || !['OWNER', 'MANAGER', 'STAFF'].includes(req.siteRole ?? '')) {
    return reply
      .code(403)
      .send({ message: 'Cette opération est réservée à l’équipe de cet établissement.' });
  }
}

export async function giftCardOperationsRoutes(app: FastifyInstance) {
  const service = new GiftCardOperationsService(db);
  const preHandler = [requireOrg(), teamAccess];
  const root = '/restaurants/:id/gift-cards';
  app.get(`${root}/operations/overview`, { preHandler }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return {
      ...(await service.overview(req.restaurantId!)),
      canExport: ['OWNER', 'MANAGER'].includes(req.siteRole ?? ''),
    };
  });
  app.get(`${root}/operations/export`, { preHandler }, async (req, reply) => {
    if (!['OWNER', 'MANAGER'].includes(req.siteRole ?? ''))
      return reply
        .code(403)
        .send({ message: 'L’export financier est réservé au propriétaire et au responsable.' });
    const date = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
    const parsed = z.object({ from: date, until: date }).strict().safeParse(req.query);
    if (!parsed.success)
      return reply.code(400).send({ message: 'Indiquez une période valide au format AAAA-MM-JJ.' });
    const from = new Date(parsed.data.from);
    const until = new Date(parsed.data.until);
    until.setUTCDate(until.getUTCDate() + 1);
    if (from >= until || until.getTime() - from.getTime() > 366 * 86400000)
      return reply.code(400).send({ message: 'Sélectionnez une période de 366 jours maximum.' });
    const result = await exportGiftCardLedger(db, req.restaurantId!, from, until);
    reply.header('Cache-Control', 'no-store');
    if (result.tooLarge)
      return reply
        .code(422)
        .send({ message: 'Plus de 5 000 paiements ou débits : réduisez la période de l’export.' });
    return result;
  });
  app.post(`${root}/operations/lookup`, { preHandler }, async (req, reply) => {
    const parsed = z
      .object({ code: z.string().trim().min(1).max(128) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Code invalide.' });
    const code = parsed.data.code;
    const card = await db.giftCard.findFirst({
      where: { restaurantId: req.restaurantId, OR: [{ code }, { shortCode: code.toUpperCase() }] },
      include: { pack: true },
    });
    if (!card)
      return reply.code(404).send({ message: 'Carte cadeau introuvable pour cet établissement.' });
    reply.header('Cache-Control', 'no-store');
    return serializeGiftCard(card);
  });
  app.get(`${root}/:giftCardId/operations`, { preHandler }, async (req, reply) => {
    const { giftCardId } = req.params as { giftCardId: string };
    try {
      const result = await service.detail(giftCardId, req.restaurantId!);
      reply.header('Cache-Control', 'no-store');
      return {
        ...result,
        card: serializeGiftCard(result.card),
        canManageDeliveries: ['OWNER', 'MANAGER'].includes(req.siteRole ?? ''),
      };
    } catch (error) {
      if (error instanceof GiftCardOperationError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });
  app.post(`${root}/:giftCardId/operations/resend`, { preHandler }, async (req, reply) => {
    if (!['OWNER', 'MANAGER'].includes(req.siteRole ?? ''))
      return reply
        .code(403)
        .send({ message: 'La reprise des envois est réservée au propriétaire et au responsable.' });
    const parsed = z
      .object({ channel: z.enum(['email', 'whatsapp']), idempotencyKey: z.string().uuid() })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Demande de renvoi invalide.' });
    const { giftCardId } = req.params as { giftCardId: string };
    try {
      return await resendGiftCardRecipient(db, {
        ...parsed.data,
        restaurantId: req.restaurantId!,
        giftCardId,
        actor: req.userId!,
      });
    } catch (error) {
      if (error instanceof GiftCardOperationError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });
  app.post(
    `${root}/:giftCardId/operations/deliveries/:deliveryId/resolve`,
    { preHandler },
    async (req, reply) => {
      if (!['OWNER', 'MANAGER'].includes(req.siteRole ?? ''))
        return reply.code(403).send({
          message: 'La résolution des envois est réservée au propriétaire et au responsable.',
        });
      const parsed = z
        .object({
          resolution: z.enum(['accepted', 'not_accepted']),
          providerCaseReference: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
        })
        .strict()
        .safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({
          message:
            'Indiquez la confirmation et une référence de dossier fournisseur sans coordonnées personnelles.',
        });
      const { giftCardId, deliveryId } = req.params as { giftCardId: string; deliveryId: string };
      try {
        return await resolveGiftCardDelivery(db, {
          ...parsed.data,
          restaurantId: req.restaurantId!,
          giftCardId,
          deliveryId,
          actor: req.userId!,
        });
      } catch (error) {
        if (error instanceof GiftCardOperationError)
          return reply.code(error.statusCode).send({ message: error.message });
        throw error;
      }
    },
  );
  for (const action of ['retry', 'verify'] as const)
    app.post(
      `${root}/:giftCardId/operations/deliveries/:deliveryId/${action}`,
      { preHandler },
      async (req, reply) => {
        if (!['OWNER', 'MANAGER'].includes(req.siteRole ?? ''))
          return reply.code(403).send({
            message: 'La reprise des envois est réservée au propriétaire et au responsable.',
          });
        const { giftCardId, deliveryId } = req.params as { giftCardId: string; deliveryId: string };
        const scoped = await db.giftCardDelivery.findFirst({
          where: { id: deliveryId, giftCardId, restaurantId: req.restaurantId },
        });
        if (!scoped) return reply.code(404).send({ message: 'Envoi introuvable.' });
        try {
          if (action === 'retry')
            return await retryGiftCardDelivery(
              db,
              req.restaurantId!,
              giftCardId,
              deliveryId,
              req.userId!,
            );
          const result = await reconcileGiftCardDelivery(db, deliveryId, req.restaurantId!);
          return {
            status: result?.status ?? scoped.status,
            canVerifyWithProvider: Boolean(scoped.providerMessageId),
          };
        } catch (error) {
          if (error instanceof GiftCardOperationError)
            return reply.code(error.statusCode).send({ message: error.message });
          throw error;
        }
      },
    );
  app.post(`${root}/:giftCardId/redeem`, { preHandler }, async (req, reply) => {
    const parsed = debitSchema.safeParse(req.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({ message: 'Montant, ticket ou identifiant de demande invalide.' });
    const { giftCardId } = req.params as { giftCardId: string };
    try {
      reply.header('Cache-Control', 'no-store');
      return await service.debit({
        ...parsed.data,
        giftCardId,
        restaurantId: req.restaurantId!,
        actor: req.userId ?? 'team',
      });
    } catch (error) {
      if (error instanceof GiftCardOperationError)
        return reply.code(error.statusCode).send({ message: error.message });
      throw error;
    }
  });
}
