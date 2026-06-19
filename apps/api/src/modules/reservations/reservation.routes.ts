import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../../shared/db/client';
import { requireOrg } from '../../plugins/clerk';
import { ReservationService } from './reservation.service';
import {
  AvailabilityQuerySchema,
  CreateReservationSchema,
  ReservationQuerySchema,
} from './reservation.schema';
import { RESERVATION_STATUS_VALUES } from '@sokar/shared';

// --- auth/public split ---
// Les routes GET/PATCH/DELETE nécessitent une organisation (dashboard manager).
// POST /reservations est publique (appelée par le pipeline vocal Telnyx).

const UpdateReservationSchema = z.object({
  status: z.enum(RESERVATION_STATUS_VALUES).optional(),
  customerName: z.string().min(1).max(200).optional(),
  partySize: z.number().int().min(1).max(20).optional(),
});

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

  app.post('/reservations', async (req, reply) => {
    const body = CreateReservationSchema.parse(req.body);
    const reservation = await ReservationService.create({
      restaurantId: body.restaurantId,
      callId: body.callId,
      reservedAt: new Date(body.reservedAt),
      partySize: body.partySize,
      customerName: body.customerName,
      customerPhone: body.customerPhone,
    });
    return reply.status(201).send(reservation);
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
