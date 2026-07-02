/**
 * Sokar Connect — Types publics et schémas Zod.
 *
 * Pas d'auth Clerk sur ces endpoints. Les données sont publiées
 * volontairement par le restaurateur (connectPublished=true).
 *
 * Source de vérité du gating : RestaurantExposureSettings
 *   - connectPublished autorise la page publique + réservation web
 *   - connectAgentic autorise l'exposition agentic avancée
 *     (JSON-LD ReserveAction, OAI-SearchBot allow, deep-link source=)
 */

import { z } from 'zod';

// ─── Slug (param URL) ─────────────────────────────────────────

export const SlugParamSchema = z.object({
  slug: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric with dashes'),
});
export type SlugParam = z.infer<typeof SlugParamSchema>;

// ─── Availability ─────────────────────────────────────────────

export const AvailabilityQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  partySize: z.coerce.number().int().min(1).max(50),
});
export type AvailabilityQuery = z.infer<typeof AvailabilityQuerySchema>;

export const AvailabilitySlotSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/),
  available: z.boolean(),
});
export type AvailabilitySlot = z.infer<typeof AvailabilitySlotSchema>;

export type AvailabilityDto = {
  restaurantId: string;
  date: string;
  partySize: number;
  slots: AvailabilitySlot[];
};

// ─── Hold ─────────────────────────────────────────────────────

export const SourceEnum = z.enum([
  'google',
  'chatgpt',
  'perplexity',
  'bing',
  'restaurant_website',
  'instagram',
  'qr_code',
  'direct',
  'unknown',
  'web',
]);
export type Source = z.infer<typeof SourceEnum>;

/** Sources "agentic" (nécessitent connectAgentic=true) */
export const AGENTIC_SOURCES: ReadonlySet<Source> = new Set([
  'chatgpt',
  'perplexity',
  'bing',
  'google', // google organic search = trafic SEO, pas agentic — MAIS traité comme agentic dans notre taxonomie pour le tracking IA-crawlers
]);

/**
 * Sources "agentic neutres" : neutralisées en 'web' si connectAgentic=false.
 * Google est EXCLU car c'est du trafic SEO organic (pas agentic).
 * Cf. spec v1.1 §5.9.
 */
export const AGENTIC_NEUTRAL_SOURCES: ReadonlySet<Source> = new Set([
  'chatgpt',
  'perplexity',
  'bing',
]);

/**
 * Normalise la source d'une réservation Connect.
 * - Si connectAgentic=false et la source est agentic-neutre → 'web'
 * - Sinon → source inchangée (google, instagram, qr_code, etc. préservés)
 * Cf. spec v1.1 §5.9.
 */
export function normalizeConnectSource(requestedSource: Source, connectAgentic: boolean): Source {
  return !connectAgentic && AGENTIC_NEUTRAL_SOURCES.has(requestedSource) ? 'web' : requestedSource;
}

export const HoldInputSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  partySize: z.number().int().min(1).max(50),
  source: SourceEnum.optional().default('web'),
});
export type HoldInput = z.infer<typeof HoldInputSchema>;

export type HoldDto = {
  holdId: string;
  holdToken: string;
  expiresAt: string; // ISO 8601
  status: 'pending';
};

// ─── Confirm ──────────────────────────────────────────────────

export const ConfirmInputSchema = z.object({
  holdToken: z.string().min(10),
  customer: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be E.164 (e.g. +33612345678)'),
    email: z.string().email().optional().or(z.literal('')),
  }),
  specialRequests: z.string().max(500).optional(),
  idempotencyKey: z.string().uuid().optional(),
  source: SourceEnum.optional().default('web'),
});
export type ConfirmInput = z.infer<typeof ConfirmInputSchema>;

export type ConfirmDto = {
  reservationId: string;
  status: 'confirmed';
  restaurantName: string;
  date: string;
  time: string;
  partySize: number;
};

// ─── Public DTO ──────────────────────────────────────────────

/** Format priceRange int (1..4) → string "€" / "€€" / "€€€" / "€€€€" */
export function priceRangeToSymbol(priceRange: number | null | undefined): string | undefined {
  if (priceRange == null) return undefined;
  if (priceRange < 1 || priceRange > 4) return undefined;
  return '€'.repeat(priceRange);
}

/** Sérialise un openingHours JSON brut en {day, open, close}[] normalisé */
export type OpeningHoursDay = {
  day: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
  open: string;
  close: string;
};
export type OpeningHoursSpec = OpeningHoursDay[];

export type PublicRestaurantDto = {
  id: string;
  slug: string;
  name: string;
  description?: string;
  address: {
    line1: string;
    postalCode?: string;
    city: string;
    country: string;
  };
  phone: string;
  cuisineTypes: string[];
  priceRange?: string;
  openingHours: OpeningHoursSpec;
  reservationUrl: string;
  images: {
    cover?: string;
    gallery: string[];
  };
  ambiance?: string[];
  dietary?: string[];
  noiseLevel?: string;
  acceptsReservations: boolean;
  publishedAt: string; // ISO 8601
  // Métadonnées internes (utiles pour le front, pas pour le SEO)
  connectAgentic: boolean;
  // Géolocalisation (exposée dans JSON-LD GeoCoordinates)
  lat?: number;
  lng?: number;
};
