/**
 * Schémas Zod des trois actions que le tour structuré exécute côté serveur (réservation, message au
 * gérant, transfert). Les arguments sont validés à l'exécution par `validateToolArgs` dans le
 * manager : pas de JSON.parse sans validation.
 *
 * Conventions :
 *  - date  → z.string().date()  (produit format: 'date' en JSON Schema)
 *  - time  → z.string().regex(HH:MM) (produit pattern en JSON Schema)
 *  - .describe() sur chaque champ pour préserver la description vue par le LLM
 */

import { z } from 'zod';

const TIME_REGEX = /^([0-1]\d|2[0-3]):[0-5]\d$/;

// z.string().date() produit `format: 'date'` en JSON Schema (contrairement à
// .datetime() qui produit format: 'date-time') et valide le format YYYY-MM-DD.
// Contrairement à l'ancien `format: 'date'` JSON Schema purement syntaxique,
// z.string().date() rejette aussi les dates calendaires invalides (ex: 2024-02-30).
const dateField = (desc: string) => z.string().date().describe(desc);

// ─── createReservation ──────────────────────────────────────────

export const CreateReservationSchema = z.object({
  date: dateField('Date au format YYYY-MM-DD'),
  time: z.string().regex(TIME_REGEX).describe('Heure au format HH:MM (ex: 19:30)'),
  partySize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .describe(
      'Nombre de personnes — au-delà du seuil du restaurant (indiqué dans les consignes), handoffToManager',
    ),
  customerName: z.string().describe('Nom complet du client'),
  customerPhone: z.string().optional().describe('Téléphone du client (optionnel)'),
});

// ─── takeMessage ────────────────────────────────────────────────

export const TakeMessageSchema = z.object({
  customerName: z.string().describe('Nom du client'),
  message: z.string().describe('Le message à transmettre au gérant'),
  callbackPhone: z
    .string()
    .optional()
    .describe('Numéro de rappel si le client en a un (optionnel)'),
});

// ─── handoffToManager ───────────────────────────────────────────

export const HandoffToManagerSchema = z.object({}).describe('');

// ─── Registre ───────────────────────────────────────────────────

export interface VoiceToolSchema {
  name: string;
  description: string;
  schema: z.ZodTypeAny;
}

export const VOICE_TOOL_SCHEMAS: VoiceToolSchema[] = [
  {
    name: 'createReservation',
    description:
      'Crée une réservation. À appeler uniquement après avoir confirmé date, heure, nombre de personnes et nom du client. Si le nom a été épelé, chaque lettre doit avoir été répétée et confirmée explicitement ; ne transforme jamais une suite comme « K I F » en un mot.',
    schema: CreateReservationSchema,
  },
  {
    name: 'takeMessage',
    description:
      'Enregistre un message du client pour le gérant. À utiliser quand le client laisse un message (demande spéciale, rappel demandé, réclamation) qui nécessite un traitement humain différé.',
    schema: TakeMessageSchema,
  },
  {
    name: 'handoffToManager',
    description:
      "Transfère l'appel au gérant. Utiliser si : groupe ≥8 personnes, demande complexe, client mécontent, ou incompréhension après 2 essais.",
    schema: HandoffToManagerSchema,
  },
];

const SCHEMA_BY_NAME = new Map<string, z.ZodTypeAny>(
  VOICE_TOOL_SCHEMAS.map((t) => [t.name, t.schema]),
);

export type ValidateToolArgsResult =
  | { success: true; data: Record<string, unknown> }
  | { success: false; error: string };

/**
 * Parse et valide les arguments JSON d'un tool vocal contre son schéma Zod.
 * Retourne `{ success, data }` si valide, sinon `{ success, error }` avec un
 * message lisible (les détails Zod sont destinés au debug interne, pas au
 * client).
 */
export function validateToolArgs(name: string, argsJson: string): ValidateToolArgsResult {
  // Les providers OpenAI-compatible émettent parfois `null` ou une chaîne
  // vide pour un tool sans argument. handoffToManager n'en attend aucun :
  // normaliser ces deux représentations évite de transformer un transfert
  // valide en demande de reformulation au milieu d'un appel.
  const serializedArgs = typeof argsJson === 'string' ? argsJson : '';
  if (name === 'handoffToManager' && !serializedArgs.trim()) {
    return { success: true, data: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serializedArgs);
  } catch {
    return {
      success: false,
      error: 'Arguments JSON invalides (non parsable).',
    };
  }

  const schema = SCHEMA_BY_NAME.get(name);
  if (!schema) {
    return { success: false, error: `Tool inconnu : ${name}` };
  }

  if (name === 'handoffToManager' && parsed === null) {
    return { success: true, data: {} };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  return { success: true, data: result.data as Record<string, unknown> };
}
