/**
 * TOOL_LIST généré depuis les schémas Zod — source de vérité unique.
 *
 * Au lieu de maintenir deux définitions (JSON Schema dans server.ts + Zod dans
 * schemas.ts), on dérive le JSON Schema directement depuis Zod via
 * zod-to-json-schema. Les métadonnées (title, description, annotations) sont
 * définies ici, à côté du schéma correspondant.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import {
  SearchRestaurantsInputSchema,
  GetRestaurantDetailsInputSchema,
  CheckAvailabilityInputSchema,
  CreateReservationInputSchema,
  CancelReservationInputSchema,
  GetReservationStatusInputSchema,
} from './schemas';

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
};

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
  annotations: ToolAnnotations;
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_restaurants',
    title: 'Search Restaurants',
    description:
      'Search restaurants available for a given party size, time, and city. slotStart and slotEnd accept ISO 8601 with Z/offset, or a local ISO time such as 2026-09-10T20:00:00 with the optional IANA timezone field. Without an offset or timezone, Europe/Paris is used. Returns matching restaurants with basic info and maxOnlinePartySize. If restaurants is empty, check capacityLimits before saying that a named restaurant does not exist: each entry gives the authoritative maxOnlinePartySize for online bookings. Never infer a maximum by trying several party sizes.',
    schema: SearchRestaurantsInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_restaurant_details',
    title: 'Get Restaurant Details',
    description:
      'Get details of a specific restaurant by ID, including name, address, cuisine, price range, opening hours, and maxOnlinePartySize.',
    schema: GetRestaurantDetailsInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'check_availability',
    title: 'Check Availability',
    description:
      'Check if a specific restaurant has availability for a party size and time slot. slotStart and slotEnd accept ISO 8601 with Z/offset, or a local ISO time such as 2026-09-10T20:00:00 with the optional IANA timezone field. Without an offset or timezone, the restaurant timezone is used. Returns availability; if the group exceeds the online capacity, the response states the exact maxOnlinePartySize instead of returning an ambiguous unavailable result.',
    schema: CheckAvailabilityInputSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_reservation',
    title: 'Create Reservation',
    description:
      'Create a reservation at a restaurant. startsAt and endsAt accept ISO 8601 with Z/offset, or a local ISO time such as 2026-09-10T20:00:00 with the optional IANA timezone field. Without an offset or timezone, the restaurant timezone is used. Requires explicit user consent for data processing. Returns reservation confirmation with ID.',
    schema: CreateReservationInputSchema,
    annotations: { destructiveHint: true },
  },
  {
    name: 'cancel_reservation',
    title: 'Cancel Reservation',
    description:
      'Cancel an existing reservation by ID. The reservation status changes to cancelled and the customer is notified.',
    schema: CancelReservationInputSchema,
    annotations: { destructiveHint: true },
  },
  {
    name: 'get_reservation_status',
    title: 'Get Reservation Status',
    description:
      'Get the status of an existing reservation by ID, including party size, date, and current state.',
    schema: GetReservationStatusInputSchema,
    annotations: { readOnlyHint: true },
  },
];

// zod-to-json-schema a des types récursifs lourds qui peuvent faire exploser
// TypeScript (`TS2589`) avec nos schémas. Le runtime est simple, donc on garde
// un wrapper typé minimal pour ne pas exposer cette complexité au build.
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: z.ZodTypeAny,
  options: Record<string, unknown>,
) => Record<string, unknown>;

// zodToJsonSchema ajoute $schema et définitions $ref qu'on ne veut pas
// dans la réponse MCP. On strip ces clés pour garder un schema propre.
function cleanJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _$schema, definitions: _definitions, ...rest } = schema;
  return rest;
}

export const TOOL_LIST = TOOL_DEFINITIONS.map((def) => ({
  name: def.name,
  title: def.title,
  description: def.description,
  inputSchema: cleanJsonSchema(toJsonSchema(def.schema, { target: 'openApi3' })),
  annotations: def.annotations,
}));
