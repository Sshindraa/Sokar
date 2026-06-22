/**
 * Schémas Zod pour les inputs des tools MCP.
 *
 * Chaque tool a un schéma strict. Pas de champs optionnels non documentés :
 * si le client envoie un champ en trop, Zod rejette avec une erreur claire.
 */

import { z } from 'zod';

// ─── search_restaurants ─────────────────────────────────────────

export const SearchRestaurantsInputSchema = z.object({
  city: z.string().min(1).max(100),
  partySize: z.number().int().min(1).max(50),
  slotStart: z.string().datetime({ offset: true }),
  slotEnd: z.string().datetime({ offset: true }),
  cuisineType: z.array(z.string()).max(10).optional(),
  maxResults: z.number().int().min(1).max(20).default(5),
});
export type SearchRestaurantsInput = z.infer<typeof SearchRestaurantsInputSchema>;

// ─── get_restaurant_details ─────────────────────────────────────

export const GetRestaurantDetailsInputSchema = z.object({
  restaurantId: z.string().uuid(),
});
export type GetRestaurantDetailsInput = z.infer<typeof GetRestaurantDetailsInputSchema>;

// ─── check_availability ─────────────────────────────────────────

export const CheckAvailabilityInputSchema = z.object({
  restaurantId: z.string().uuid(),
  partySize: z.number().int().min(1).max(50),
  slotStart: z.string().datetime({ offset: true }),
  slotEnd: z.string().datetime({ offset: true }),
});
export type CheckAvailabilityInput = z.infer<typeof CheckAvailabilityInputSchema>;

// ─── create_reservation ──────────────────────────────────────────

export const CreateReservationInputSchema = z.object({
  restaurantId: z.string().uuid(),
  partySize: z.number().int().min(1).max(50),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  customerName: z.string().min(1).max(100),
  customerPhone: z.string().regex(/^\+[1-9]\d{9,14}$/, 'E.164 phone required'),
  specialRequests: z.string().max(500).optional(),
  holdToken: z.string().optional(),
  idempotencyKey: z.string().min(1).max(100),
  consents: z
    .object({
      reservationProcessing: z.literal(true),
      transactionalSms: z.boolean().default(false),
      transactionalEmail: z.boolean().default(false),
      marketingOptIn: z.boolean().default(false),
    })
    .refine((v) => v.reservationProcessing === true, {
      message: 'reservationProcessing consent is mandatory',
    }),
});
export type CreateReservationInput = z.infer<typeof CreateReservationInputSchema>;

// ─── cancel_reservation ──────────────────────────────────────────

export const CancelReservationInputSchema = z.object({
  reservationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type CancelReservationInput = z.infer<typeof CancelReservationInputSchema>;

// ─── get_reservation_status (interne) ────────────────────────────

export const GetReservationStatusInputSchema = z.object({
  reservationId: z.string().uuid(),
});
export type GetReservationStatusInput = z.infer<typeof GetReservationStatusInputSchema>;
