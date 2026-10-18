import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireOrg } from '../../plugins/clerk';
import { ReservationService, RESERVATION_REPLAY_SCOPE_MISMATCH } from './reservation.service';
import { requireReservationService } from './reservation-auth';
import {
  AvailabilityQuerySchema,
  CreateReservationSchema,
  ReservationQuerySchema,
} from './reservation.schema';
import { ERROR_CODE_MESSAGES, RESERVATION_STATUS_VALUES } from '@sokar/shared';
import { db } from '../../shared/db/client';
import { reservationManagementUrl } from './reservation-management';
import {
  createWhatsAppReminderConsent,
  withdrawWhatsAppReminderConsent,
} from '../connect/whatsapp-consent';
import {
  isSlotTooSoon,
  leadTimeRefusal,
  loadMinLeadTimeMinutes,
} from '../../shared/reservations/lead-time';

// --- auth/public split ---
// Les routes GET/PATCH/DELETE nécessitent une organisation (dashboard manager).
// POST /reservations reste disponible pour les intégrations legacy, mais elle
// est interne : le pipeline vocal appelle ReservationService directement et
// les réservations Connect passent par les routes hold/confirm signées.

const UpdateReservationSchema = z.object({
  status: z.enum(RESERVATION_STATUS_VALUES).optional(),
  customerName: z.string().min(1).max(200).optional(),
  partySize: z.number().int().min(1).max(20).optional(),
});

function createSlotNotAvailableError() {
  const error = new Error(ERROR_CODE_MESSAGES.SLOT_NOT_AVAILABLE);
  error.name = 'SLOT_NOT_AVAILABLE';
  return Object.assign(error, { statusCode: 409 });
}

export async function reservationRoutes(app: FastifyInstance) {
  app.post(
    '/public/reservations/whatsapp-consent/withdraw',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parsed = z
        .object({
          restaurantId: z.string().min(1).max(100),
          reservationId: z.string().min(1).max(100),
          token: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' });
      const { restaurantId, reservationId, token } = parsed.data;
      const outcome = await withdrawWhatsAppReminderConsent(db, restaurantId, reservationId, token);
      if (outcome === 'not_found') return reply.status(404).send({ error: 'Not found' });
      if (outcome === 'conflict') return reply.status(409).send({ error: 'Veuillez réessayer.' });
      return reply.send({ status: 'withdrawn' });
    },
  );
  app.get('/reservations', { preHandler: requireOrg() }, async (req, reply) => {
    const query = ReservationQuerySchema.parse(req.query);
    const reservations = await ReservationService.findByRestaurant(req.restaurantId!, query.date);
    return reply.send(reservations);
  });

  app.get('/restaurants/:id/availability', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = AvailabilityQuerySchema.parse(req.query);
    // Page /book : surface en ligne, donc soumise au délai minimum du restaurant.
    const availability = await ReservationService.availability(id, query.date, query.partySize, {
      minLeadTimeMinutes: await loadMinLeadTimeMinutes(db, id),
    });
    return reply.send(availability);
  });

  app.post('/reservations', { preHandler: requireReservationService }, async (req, reply) => {
    const body = CreateReservationSchema.parse(req.body);
    if (body.whatsappReminderConsent?.accepted && process.env.WHATSAPP_CONSENT_ENABLED !== 'true') {
      return reply
        .status(409)
        .send({ error: 'Le rappel WhatsApp n’est pas disponible actuellement.' });
    }
    const whatsappConsent = createWhatsAppReminderConsent(
      body.whatsappReminderConsent?.accepted === true,
    );
    // Cette route est la création de la page /book (la voix passe par ReservationService, sans HTTP) :
    // elle applique le délai minimum, comme l'affichage des créneaux. Le service, lui, ne l'applique
    // pas : la voix et le personnel ne sont pas concernés.
    const minLeadTimeMinutes = await loadMinLeadTimeMinutes(db, body.restaurantId);
    if (isSlotTooSoon(new Date(body.reservedAt), minLeadTimeMinutes)) {
      return reply.status(409).send(leadTimeRefusal(minLeadTimeMinutes));
    }
    try {
      const reservation = await ReservationService.create({
        restaurantId: body.restaurantId,
        ...(body.whatsappReminderConsent ? { channel: 'WEB' as const } : {}),
        callId: body.callId,
        reservedAt: new Date(body.reservedAt),
        partySize: body.partySize,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        marketingAttributionToken: body.marketingAttributionToken,
        ...(body.whatsappReminderConsent ? { consents: whatsappConsent.consents } : {}),
      });
      const saved = reservation.consents as Record<string, unknown> | null;
      return reply.status(201).send({
        ...reservation,
        managementUrl: reservationManagementUrl(reservation),
        ...(whatsappConsent.withdrawalToken &&
        saved?.whatsappWithdrawalTokenHash === whatsappConsent.consents.whatsappWithdrawalTokenHash
          ? { whatsappWithdrawalToken: whatsappConsent.withdrawalToken }
          : {}),
      });
    } catch (err) {
      if (err instanceof Error && err.message === 'SLOT_NOT_AVAILABLE') {
        throw createSlotNotAvailableError();
      }
      if (err instanceof Error && err.message === RESERVATION_REPLAY_SCOPE_MISMATCH) {
        return reply.status(409).send({ error: 'RESERVATION_REPLAY_REJECTED' });
      }
      throw err;
    }
  });

  app.post('/reservations/:id/allocate-table', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    try {
      const updated = await ReservationService.allocateTable(id, req.restaurantId!);
      return reply.send(updated);
    } catch (err) {
      if (err instanceof Error && err.message === 'SLOT_NOT_AVAILABLE') {
        throw createSlotNotAvailableError();
      }
      throw err;
    }
  });

  app.patch('/reservations/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = UpdateReservationSchema.parse(req.body);
    const restaurantId = req.restaurantId!;
    const updated = await ReservationService.update(id, restaurantId, body);
    return reply.send(updated);
  });

  app.delete('/reservations/:id', { preHandler: requireOrg() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const restaurantId = req.restaurantId!;
    await ReservationService.delete(id, restaurantId);
    return reply.status(204).send();
  });
}
