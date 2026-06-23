/**
 * Test de cohérence : vérifie que TOOL_LIST (server.ts) et les
 * schémas Zod (schemas.ts) restent synchronisés.
 *
 * Sans ce test, quelqu'un peut ajouter un champ au schema Zod mais
 * oublier de mettre à jour le JSON schema dans TOOL_LIST (ou inversement).
 * C'est le risque de drift #15 de l'audit.
 */

import { describe, expect, it } from 'vitest';
import { TOOL_LIST } from '../../server';
import {
  SearchRestaurantsInputSchema,
  GetRestaurantDetailsInputSchema,
  CheckAvailabilityInputSchema,
  CreateReservationInputSchema,
  CancelReservationInputSchema,
  GetReservationStatusInputSchema,
} from '../schemas';

describe('TOOL_LIST ↔ Zod schema consistency', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schemas: Record<string, any> = {
    search_restaurants: SearchRestaurantsInputSchema,
    get_restaurant_details: GetRestaurantDetailsInputSchema,
    check_availability: CheckAvailabilityInputSchema,
    create_reservation: CreateReservationInputSchema,
    cancel_reservation: CancelReservationInputSchema,
    get_reservation_status: GetReservationStatusInputSchema,
  };

  it('TOOL_LIST has exactly 6 tools', () => {
    expect(TOOL_LIST).toHaveLength(6);
  });

  it('every tool has a title', () => {
    for (const tool of TOOL_LIST) {
      expect(tool.title, `${tool.name} missing title`).toBeDefined();
      expect(typeof tool.title).toBe('string');
      expect(tool.title!.length).toBeGreaterThan(0);
    }
  });

  it('every tool has annotations with readOnly or destructive hint', () => {
    for (const tool of TOOL_LIST) {
      const ann = (tool as any).annotations || {};
      const hasReadOnly = ann.readOnlyHint === true;
      const hasDestructive = ann.destructiveHint === true;
      expect(
        hasReadOnly || hasDestructive,
        `${tool.name} must have readOnlyHint or destructiveHint`,
      ).toBe(true);
    }
  });

  it('every tool name matches a Zod schema', () => {
    for (const tool of TOOL_LIST) {
      expect(schemas[tool.name], `${tool.name} has no matching Zod schema`).toBeDefined();
    }
  });

  it('every required field in TOOL_LIST JSON schema is required in Zod', () => {
    for (const tool of TOOL_LIST) {
      const schema = schemas[tool.name];
      if (!schema) continue;

      const jsonRequired = (tool.inputSchema as any).required as string[] | undefined;
      if (!jsonRequired) continue;

      const zodShape = schema.shape as Record<string, any>;
      for (const field of jsonRequired) {
        expect(
          zodShape[field],
          `${tool.name}: field "${field}" is required in TOOL_LIST but missing from Zod schema`,
        ).toBeDefined();
      }
    }
  });

  it('search_restaurants has cursor field in TOOL_LIST', () => {
    const searchTool = TOOL_LIST.find((t) => t.name === 'search_restaurants');
    expect(searchTool).toBeDefined();
    const props = (searchTool!.inputSchema as any).properties;
    expect(props.cursor).toBeDefined();
  });
});
