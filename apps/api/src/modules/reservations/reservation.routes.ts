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
  app.get('/reservations', { preHandler: requireOrg() }, async (req, reply) => {
    const query = ReservationQuerySchema.parse(req.query);
    const reservations = await ReservationService.findByRestaurant(req.restaurantId!, query.date);
    return reply.send(reservations);
  });

  app.get('/restaurants/:id/availability', async (req, reply) => {
    const { id } = req.params as { id: string };
    const query = AvailabilityQuerySchema.parse(req.query);
    const availability = await ReservationService.availability(id, query.date, query.partySize);
    return reply.send(availability);
  });

  app.post('/reservations', { preHandler: requireReservationService }, async (req, reply) => {
    const body = CreateReservationSchema.parse(req.body);
    try {
      const reservation = await ReservationService.create({
        restaurantId: body.restaurantId,
        callId: body.callId,
        reservedAt: new Date(body.reservedAt),
        partySize: body.partySize,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
      });
      return reply.status(201).send(reservation);
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
