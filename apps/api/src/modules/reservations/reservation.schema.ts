import { z } from 'zod';

export const CreateReservationSchema = z.object({
  restaurantId: z.string(),
  callId: z.string().optional(),
  reservedAt: z.string().datetime(),
  partySize: z.number().int().min(1).max(20),
  customerName: z.string().min(1).max(200),
  customerPhone: z
    .string()
    .regex(/^\+?[0-9]{10,15}$/)
    .optional(),
});

export const ReservationQuerySchema = z.object({
  restaurantId: z.string(),
  date: z.string().date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const AvailabilityQuerySchema = z.object({
  date: z.string().date(),
  partySize: z.coerce.number().int().min(1).max(20).default(2),
});

export type CreateReservationInput = z.infer<typeof CreateReservationSchema>;
export type ReservationQuery = z.infer<typeof ReservationQuerySchema>;
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;
