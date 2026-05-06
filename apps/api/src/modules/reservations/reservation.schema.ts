import { z } from 'zod';

export const CreateReservationSchema = z.object({
  restaurantId: z.string().uuid(),
  callId:       z.string().uuid().optional(),
  reservedAt:   z.string().datetime(),
  partySize:    z.number().int().min(1).max(20),
  customerName: z.string().min(1).max(200),
  customerPhone: z.string().regex(/^\+?[0-9]{10,15}$/).optional(),
});

export const ReservationQuerySchema = z.object({
  restaurantId: z.string().uuid(),
  date:         z.string().date().optional(),
  limit:        z.coerce.number().int().min(1).max(100).default(50),
  offset:       z.coerce.number().int().min(0).default(0),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export type ReservationQuery = z.infer<typeof ReservationQuerySchema>;
