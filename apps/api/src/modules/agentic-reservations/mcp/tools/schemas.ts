/**
 * Schémas Zod pour les inputs des tools MCP.
 *
 * Chaque tool a un schéma strict. Pas de champs optionnels non documentés :
 * si le client envoie un champ en trop, Zod rejette avec une erreur claire.
 */

import { z } from 'zod';
import { MCP_DATE_TIME_PATTERN } from './date-time';

const McpDateTimeSchema = z
  .string()
  .regex(
    MCP_DATE_TIME_PATTERN,
    'ISO 8601 date-time expected, with an offset (Z/+02:00) or a local time plus timezone',
  )
  .describe(
    'ISO 8601 date-time. Use Z or an offset when possible; a local value such as 2026-09-10T20:00:00 is accepted with timezone.',
  );

const McpTimezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .describe('Optional IANA timezone for local date-times, for example Europe/Paris.');

// ─── search_restaurants ─────────────────────────────────────────

export const SearchRestaurantsInputSchema = z.object({
  city: z.string().min(1).max(100),
  restaurantName: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe('Optional name supplied by the person. Include it when they name a restaurant.'),
  partySize: z.number().int().min(1).max(50),
  slotStart: McpDateTimeSchema,
  slotEnd: McpDateTimeSchema.optional().describe(
    'Include only if the person supplied an end time or duration. For « vers 19 h », use slotStart at 19:00 and omit slotEnd; Sokar uses a 120-minute default.',
  ),
  timezone: McpTimezoneSchema.optional(),
  cuisineType: z.array(z.string()).max(10).optional(),
  maxResults: z.number().int().min(1).max(20).default(5),
  cursor: z
    .string()
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
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
  slotStart: McpDateTimeSchema,
  slotEnd: McpDateTimeSchema,
  timezone: McpTimezoneSchema.optional(),
});
export type CheckAvailabilityInput = z.infer<typeof CheckAvailabilityInputSchema>;

// A quote leaves capacity free; a hold temporarily reserves it.
export const CreateQuoteInputSchema = CheckAvailabilityInputSchema;
export const CreateHoldInputSchema = CheckAvailabilityInputSchema;

// ─── create_reservation ──────────────────────────────────────────

export const CreateReservationInputSchema = z.object({
  restaurantId: z.string().uuid(),
  partySize: z.number().int().min(1).max(50),
  startsAt: McpDateTimeSchema,
  endsAt: McpDateTimeSchema,
  timezone: McpTimezoneSchema.optional(),
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
  customerPhone: z
    .string()
    .regex(/^\+[1-9]\d{9,14}$/)
    .optional(),
  reason: z.string().max(500).optional(),
});
export type CancelReservationInput = z.infer<typeof CancelReservationInputSchema>;

export const ModifyReservationInputSchema = z
  .object({
    reservationId: z.string().uuid(),
    customerPhone: z
      .string()
      .regex(/^\+[1-9]\d{9,14}$/)
      .optional(),
    partySize: z.number().int().min(1).max(50).optional(),
    startsAt: McpDateTimeSchema.optional(),
    endsAt: McpDateTimeSchema.optional(),
    timezone: McpTimezoneSchema.optional(),
    customerName: z.string().min(1).max(100).optional(),
  })
  .refine((value) => Boolean(value.partySize || value.startsAt || value.customerName), {
    message: 'At least one field to modify is required',
  })
  .refine((value) => Boolean(value.startsAt) === Boolean(value.endsAt), {
    message: 'startsAt and endsAt must be provided together',
  });
export type ModifyReservationInput = z.infer<typeof ModifyReservationInputSchema>;

// ─── get_reservation_status (interne) ────────────────────────────

export const GetReservationStatusInputSchema = z.object({
  reservationId: z.string().uuid(),
  customerPhone: z
    .string()
    .regex(/^\+[1-9]\d{9,14}$/)
    .optional(),
});
export type GetReservationStatusInput = z.infer<typeof GetReservationStatusInputSchema>;

export const JoinWaitingListInputSchema = z.object({
  restaurantId: z.string().uuid(),
  partySize: z.number().int().min(1).max(50),
  slotStart: McpDateTimeSchema,
  slotEnd: McpDateTimeSchema,
  timezone: McpTimezoneSchema.optional(),
  customerFirstName: z.string().min(1).max(100),
  customerLastName: z.string().max(100).optional(),
  customerPhone: z.string().regex(/^\+[1-9]\d{9,14}$/),
  customerEmail: z.string().email().optional(),
  consents: z
    .object({
      waitingListProcessing: z.literal(true),
      reservationProcessing: z.literal(true),
      transactionalSms: z.boolean().default(false),
      transactionalEmail: z.boolean().default(false),
      marketingOptIn: z.boolean().default(false),
    })
    .refine(
      (value) => value.waitingListProcessing === true && value.reservationProcessing === true,
      {
        message: 'waitingListProcessing and reservationProcessing consents are mandatory',
      },
    ),
});

export const CancelWaitingListInputSchema = z.object({
  restaurantId: z.string().uuid(),
  entryId: z.string().uuid(),
  actionToken: z.string().min(20).max(100),
});

// ─── output schemas MCP ────────────────────────────────────────

const OutputUuidSchema = z.string().uuid();
const OutputDateTimeSchema = z.string();
const NullableOutputStringSchema = z.string().nullable();

const RestaurantSummaryOutputSchema = z
  .object({
    id: OutputUuidSchema,
    name: z.string(),
    slug: NullableOutputStringSchema,
    formattedAddress: NullableOutputStringSchema,
    cuisineType: z.array(z.string()),
    priceRange: z.number().int().nullable(),
    maxOnlinePartySize: z.number().int(),
  })
  .strict();

const RestaurantAvailableSlotOutputSchema = z
  .object({
    startsAt: OutputDateTimeSchema,
    endsAt: OutputDateTimeSchema,
  })
  .strict();

const AvailableRestaurantSummaryOutputSchema = RestaurantSummaryOutputSchema.extend({
  availableSlots: z.array(RestaurantAvailableSlotOutputSchema).min(1),
}).strict();

export const SearchRestaurantsOutputSchema = z
  .object({
    searchOutcome: z
      .enum(['available', 'capacity_exceeded', 'no_exact_slot_available'])
      .describe(
        'Whether the exact search found a slot, hit a party-size limit, or found no match for that exact request. no_exact_slot_available does not mean the restaurant does not exist; offer another time and never ask the person for a restaurant ID.',
      ),
    requestedRestaurant: z
      .object({
        id: OutputUuidSchema.optional().describe(
          'Internal ID. Never show or ask the person for it.',
        ),
        name: z.string(),
        status: z
          .enum(['available', 'unavailable', 'capacity_exceeded', 'not_found'])
          .describe(
            'Authoritative result for a restaurantName supplied in the request. unavailable means the named restaurant was found but has no availability for this exact request; not_found means no matching MCP-visible restaurant was found in the requested city. Never infer this from the restaurants array and never ask for an ID.',
          ),
      })
      .strict()
      .optional(),
    restaurants: z.array(AvailableRestaurantSummaryOutputSchema),
    capacityLimits: z.array(RestaurantSummaryOutputSchema),
    nextCursor: z.string().optional(),
  })
  .strict();

export const GetRestaurantDetailsOutputSchema = z
  .object({
    id: OutputUuidSchema,
    name: z.string(),
    slug: NullableOutputStringSchema,
    formattedAddress: NullableOutputStringSchema,
    websiteUrl: NullableOutputStringSchema,
    cuisineType: z.array(z.string()),
    priceRange: z.number().int().nullable(),
    ambiance: z.array(z.string()),
    noiseLevel: z.string().nullable(),
    dietary: z.array(z.string()),
    openingHours: z.unknown(),
    maxOnlinePartySize: z.number().int(),
  })
  .strict();

export const CheckAvailabilityOutputSchema = z
  .object({
    available: z.boolean(),
    alternativeSlots: z
      .array(
        z
          .object({
            startsAt: OutputDateTimeSchema,
            endsAt: OutputDateTimeSchema,
          })
          .strict(),
      )
      .optional(),
    conflictingHoldId: OutputUuidSchema.optional().describe(
      'Compatibility field; the adapter does not return internal hold identifiers.',
    ),
    conflictingReservationId: OutputUuidSchema.optional().describe(
      'Compatibility field; the adapter does not return internal reservation identifiers.',
    ),
    reason: z
      .enum(['hold_active', 'reservation_confirmed', 'party_size_exceeds_capacity', 'unknown'])
      .optional(),
    maxOnlinePartySize: z.number().int().optional(),
    decision: z.enum(['available', 'unavailable', 'capacity_exceeded']),
    recommendedAction: z.enum([
      'create_hold',
      'request_reserve_scope',
      'choose_alternative_slot',
      'reduce_party_size',
      'choose_another_slot',
    ]),
  })
  .strict();

export const CreateQuoteOutputSchema = z
  .object({
    quoteId: OutputUuidSchema,
    expiresAt: OutputDateTimeSchema,
  })
  .strict();

export const CreateHoldOutputSchema = z
  .object({
    holdToken: z.string(),
    expiresAt: OutputDateTimeSchema,
  })
  .strict();

export const CreateReservationOutputSchema = z
  .object({
    reservationId: OutputUuidSchema,
    state: z.string(),
    reused: z.boolean(),
  })
  .strict();

export const JoinWaitingListOutputSchema = z
  .object({
    entryId: OutputUuidSchema,
    position: z.number().int(),
    actionToken: z.string(),
  })
  .strict();

export const CancelWaitingListOutputSchema = z
  .object({
    entryId: OutputUuidSchema,
    status: z.string(),
  })
  .strict();

export const ModifyReservationOutputSchema = z
  .object({
    reservationId: OutputUuidSchema,
    state: z.string(),
    changed: z.boolean(),
  })
  .strict();

export const CancelReservationOutputSchema = z
  .object({
    cancelled: z.literal(true),
  })
  .strict();

export const GetReservationStatusOutputSchema = z
  .object({
    id: OutputUuidSchema,
    state: z.string(),
    partySize: z.number().int(),
    startsAt: OutputDateTimeSchema,
    endsAt: OutputDateTimeSchema.nullable(),
    createdAt: OutputDateTimeSchema,
  })
  .strict();
