/**
 * Zod schemas pour les types OpenAI Reserve.
 *
 * Ces types sont le contrat public servi à OpenAI (business feed) et
 * consommés par le widget. Toute modification = breaking change.
 */

import { z } from 'zod';

export const BusinessAddressSchema = z.object({
  line1: z.string(),
  line2: z.string().optional(),
  locality: z.string(),
  region: z.string(),
  postal_code: z.string(),
  country: z.string().length(2),
  formatted: z.string(),
});
export type BusinessAddress = z.infer<typeof BusinessAddressSchema>;

export const BusinessLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type BusinessLocation = z.infer<typeof BusinessLocationSchema>;

export const BusinessSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.union([BusinessAddressSchema, z.string()]),
  location: BusinessLocationSchema,
  phone_number: z.string(),
  website_url: z.string().url().optional().nullable(),
  platform_url: z.string().url(),
  // Métadonnées Sokar (optionnel dans la spec mais utile pour le widget)
  cuisine_type: z.array(z.string()).optional().nullable(),
  price_range: z.number().int().min(1).max(4).optional().nullable(),
  opening_hours: z.record(z.string(), z.array(z.string())).optional().nullable(),
});
export type Business = z.infer<typeof BusinessSchema>;

export const FeedQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  changes_token: z.string().optional(),
});
export type FeedQuery = z.infer<typeof FeedQuerySchema>;

export const FeedResponseSchema = z.object({
  checksum: z.boolean(),
  page: z.number().int(),
  page_size: z.number().int(),
  total_pages: z.number().int(),
  total: z.number().int(),
  businesses: z.array(BusinessSchema),
  changes_token: z.string().optional(),
});
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

// ─── Tool restaurant_reservation input/output ─────────────────────

export const RestaurantReservationInputSchema = z.object({
  restaurant_id: z.string().min(1),
  // Optional optimistic rendering
  restaurant_name: z.string().optional(),
  restaurant_image: z.string().url().optional(),
  restaurant_address: z
    .object({
      address: z.string(),
      city: z.string(),
      state: z.string(),
      zipcode: z.string(),
      country: z.string(),
    })
    .optional(),
});
export type RestaurantReservationInput = z.infer<typeof RestaurantReservationInputSchema>;

export const RestaurantReservationOutputSchema = z.object({
  restaurant_id: z.string(),
  restaurant_name: z.string(),
  restaurant_address: BusinessAddressSchema.optional(),
  // Le widget chargera les détails via un autre tool call widget-accessible
  widget_resource_url: z.string(),
});
export type RestaurantReservationOutput = z.infer<typeof RestaurantReservationOutputSchema>;
