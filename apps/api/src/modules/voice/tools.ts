/**
 * Tools vocaux exposés au LLM (style function-calling OpenAI).
 *
 * Le JSON Schema de chaque tool est dérivé des schémas Zod dans
 * `tool-schemas.ts` via zod-to-json-schema — source de vérité unique. Les
 * descriptions et contraintes viennent des `.describe()` et des méthodes Zod
 * (min/max/regex/int...).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import { VOICE_TOOL_SCHEMAS } from './tool-schemas';

// zod-to-json-schema a des types récursifs lourds qui peuvent faire exploser
// TypeScript (TS2589). Le runtime est simple, on garde un wrapper typé minimal.
const toJsonSchema = zodToJsonSchema as unknown as (
  schema: z.ZodTypeAny,
  options: Record<string, unknown>,
) => Record<string, unknown>;

/**
 * Dérive le JSON Schema "parameters" d'un schéma Zod, sans l'enveloppe
 * { $schema, definitions } ni additionalProperties (pour rester équivalent au
 * JSON Schema écrit à la main précédent).
 */
function toParameters(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = toJsonSchema(schema, { name: undefined });
  const { $schema: _$schema, additionalProperties: _ap, ...rest } = raw;
  // zod-to-json-schema omet `required` quand l'objet n'a aucun champ requis
  // (ex: handoffToManager). Le JSON Schema précédent avait toujours `required`.
  if (!('required' in rest)) {
    rest.required = [];
  }
  return rest;
}

export function getRestaurantTools(_restaurantId: string) {
  return VOICE_TOOL_SCHEMAS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toParameters(tool.schema),
    },
  }));
}
