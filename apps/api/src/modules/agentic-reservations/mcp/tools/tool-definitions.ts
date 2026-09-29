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
  CreateQuoteInputSchema,
  CreateHoldInputSchema,
  JoinWaitingListInputSchema,
  CancelWaitingListInputSchema,
  ModifyReservationInputSchema,
  CreateReservationInputSchema,
  CancelReservationInputSchema,
  GetReservationStatusInputSchema,
  SearchRestaurantsOutputSchema,
  GetRestaurantDetailsOutputSchema,
  CheckAvailabilityOutputSchema,
  CreateQuoteOutputSchema,
  CreateHoldOutputSchema,
  CreateReservationOutputSchema,
  JoinWaitingListOutputSchema,
  CancelWaitingListOutputSchema,
  ModifyReservationOutputSchema,
  CancelReservationOutputSchema,
  GetReservationStatusOutputSchema,
} from './schemas';

type ToolAnnotations = {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

type ToolDefinition = {
  name: string;
  title: string;
  description: string;
  schema: z.ZodTypeAny;
  output: z.ZodTypeAny;
  requiredScope: 'mcp:read' | 'mcp:reserve' | 'mcp:cancel';
  annotations: ToolAnnotations;
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'search_restaurants',
    title: 'Search Restaurants',
    description:
      'Search restaurants available for a given party size, time, and city. slotStart and slotEnd accept ISO 8601 with Z/offset, or a local ISO time such as 2026-09-10T20:00:00 with the optional IANA timezone field. Without an offset or timezone, Europe/Paris is used. Each match includes its public address, cuisine, price range, online party-size limit, and the exact available slot. If restaurants is empty, check capacityLimits before saying that a named restaurant does not exist: each entry gives the public restaurant details and authoritative maxOnlinePartySize for online bookings. Never infer a maximum by trying several party sizes.',
    schema: SearchRestaurantsInputSchema,
    output: SearchRestaurantsOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_restaurant_details',
    title: 'Get Restaurant Details',
    description:
      'Get details of a specific restaurant by ID, including name, address, cuisine, price range, opening hours, and maxOnlinePartySize.',
    schema: GetRestaurantDetailsInputSchema,
    output: GetRestaurantDetailsOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'check_availability',
    title: 'Check Availability',
    description:
      'Check if a specific restaurant has availability for a party size and time slot. slotStart and slotEnd accept ISO 8601 with Z/offset, or a local ISO time such as 2026-09-10T20:00:00 with the optional IANA timezone field. Without an offset or timezone, the restaurant timezone is used. Successful availability results include a decision and recommendedAction: create_hold when an available slot and mcp:reserve scope are present, request_reserve_scope when the slot is available but the scope is missing, choose_alternative_slot when alternatives exist, or choose_another_slot otherwise. If party size exceeds the online capacity, the existing POLICY_VIOLATION error message includes the exact maxPartySize; reduce the requested party size. Internal hold and reservation identifiers are never returned.',
    schema: CheckAvailabilityInputSchema,
    output: CheckAvailabilityOutputSchema,
    requiredScope: 'mcp:read',
    annotations: { readOnlyHint: true },
  },
  {
    name: 'create_quote',
    title: 'Quote Reservation',
    description: 'Check a slot and return a short-lived quote without reserving capacity.',
    schema: CreateQuoteInputSchema,
    output: CreateQuoteOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_hold',
    title: 'Hold Reservation Slot',
    description:
      'Temporarily reserve a slot while the customer confirms. Pass the returned holdToken to create_reservation before it expires.',
    schema: CreateHoldInputSchema,
    output: CreateHoldOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  {
    name: 'create_reservation',
    title: 'Create Reservation',
    description:
      'Create a reservation at a restaurant. startsAt and endsAt accept ISO 8601 with Z/offset, or a local ISO time such as 2026-09-10T20:00:00 with the optional IANA timezone field. Without an offset or timezone, the restaurant timezone is used. Requires explicit user consent for data processing. Returns reservation confirmation with ID.',
    schema: CreateReservationInputSchema,
    output: CreateReservationOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'join_waiting_list',
    title: 'Join Waiting List',
    description:
      'Join the waiting list for a full slot when the restaurant has enabled it. Requires customer consent.',
    schema: JoinWaitingListInputSchema,
    output: JoinWaitingListOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { destructiveHint: true, openWorldHint: true },
  },
  {
    name: 'cancel_waiting_list',
    title: 'Leave Waiting List',
    description: 'Cancel a waiting list entry with the action token returned when joining.',
    schema: CancelWaitingListInputSchema,
    output: CancelWaitingListOutputSchema,
    requiredScope: 'mcp:cancel',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'modify_reservation',
    title: 'Modify Reservation',
    description:
      'Change a reservation time, party size, or customer name after verifying the original phone number. Availability is rechecked atomically.',
    schema: ModifyReservationInputSchema,
    output: ModifyReservationOutputSchema,
    requiredScope: 'mcp:reserve',
    annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'cancel_reservation',
    title: 'Cancel Reservation',
    description:
      'Cancel an existing reservation by ID. Public OAuth clients must supply the original E.164 customerPhone. The reservation status changes to cancelled and the customer is notified.',
    schema: CancelReservationInputSchema,
    output: CancelReservationOutputSchema,
    requiredScope: 'mcp:cancel',
    annotations: { destructiveHint: true },
  },
  {
    name: 'get_reservation_status',
    title: 'Get Reservation Status',
    description:
      'Get the status of an existing reservation by ID, including party size, date, and current state. Public OAuth clients must supply the original E.164 customerPhone.',
    schema: GetReservationStatusInputSchema,
    output: GetReservationStatusOutputSchema,
    requiredScope: 'mcp:read',
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
  outputSchema: cleanJsonSchema(toJsonSchema(def.output, { target: 'openApi3' })),
  securitySchemes: [{ type: 'oauth2' as const, scopes: [def.requiredScope] }],
  annotations: def.annotations,
}));
