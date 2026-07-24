/**
 * Schémas Zod pour les 8 tools vocaux — source de vérité unique.
 *
 * Le JSON Schema exposé au LLM (dans tools.ts) est dérivé de ces schémas via
 * zod-to-json-schema, et les arguments sont validés à l'exécution par
 * `validateToolArgs` dans le manager. Plus de JSON.parse sans validation.
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
    .max(7)
    .describe('Nombre de personnes — ≥8 déclenche handoffToManager'),
  customerName: z.string().describe('Nom complet du client'),
  customerPhone: z.string().optional().describe('Téléphone du client (optionnel)'),
});

// ─── checkAvailability ──────────────────────────────────────────

export const CheckAvailabilitySchema = z.object({
  date: dateField('Date au format YYYY-MM-DD'),
  partySize: z.number().int().min(1).max(7).describe('Nombre de personnes'),
  time: z
    .string()
    .regex(TIME_REGEX)
    .optional()
    .describe('Heure demandée au format HH:MM (optionnel)'),
});

// ─── cancelReservation ──────────────────────────────────────────

export const CancelReservationSchema = z.object({
  customerName: z.string().describe("Nom du client tel qu' donné lors de la réservation"),
  date: dateField('Date de la réservation au format YYYY-MM-DD'),
  time: z
    .string()
    .regex(TIME_REGEX)
    .optional()
    .describe(
      'Heure de la réservation au format HH:MM (optionnel, ne demander que si le client la fournit spontanément pour lever une ambiguïté)',
    ),
});

// ─── reportDelay ────────────────────────────────────────────────

export const ReportDelaySchema = z.object({
  customerName: z.string().describe('Nom complet du client'),
  date: dateField('Date au format YYYY-MM-DD'),
  time: z.string().regex(TIME_REGEX).describe('Heure réservée au format HH:MM'),
  delayMinutes: z.number().int().min(5).max(180).describe('Retard annoncé en minutes'),
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

// ─── purchaseGiftCard ───────────────────────────────────────────

export const PurchaseGiftCardSchema = z.object({
  amount: z.number().min(1).multipleOf(1).describe('Montant en euros — obligatoire (entier)'),
  occasion: z.string().optional().describe('Occasion (anniversaire, remerciement, etc.)'),
  senderName: z.string().describe("Nom de l'expéditeur"),
  senderPhone: z
    .string()
    .describe("Téléphone de l'expéditeur au format international (ex: +33612345678)"),
  recipientName: z.string().describe('Nom du destinataire'),
  message: z.string().optional().describe('Message personnalisé (optionnel)'),
});

// ─── recommendGiftCardAmount ────────────────────────────────────

export const RecommendGiftCardAmountSchema = z.object({
  occasion: z.string().describe('Occasion'),
  partySize: z.number().int().min(1).describe('Nombre de personnes'),
  budget: z.number().optional().describe('Budget maximum (optionnel)'),
});

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
      'Crée une réservation. À appeler uniquement après avoir confirmé date, heure, nombre de personnes et nom du client.',
    schema: CreateReservationSchema,
  },
  {
    name: 'checkAvailability',
    description:
      'Vérifie immédiatement les disponibilités dès que la date et le nombre de personnes sont connus. Si le client a indiqué une heure, la transmettre aussi. Ne jamais annoncer une vérification sans appeler cet outil dans le même tour.',
    schema: CheckAvailabilitySchema,
  },
  {
    name: 'cancelReservation',
    description:
      "Annule une réservation existante. À appeler quand le client demande explicitement à annuler. Demander le nom et la date pour identifier la réservation avant d'annuler.",
    schema: CancelReservationSchema,
  },
  {
    name: 'reportDelay',
    description:
      'Signale le retard d’un client au Copilot de salle. À appeler uniquement après avoir confirmé le nom, la date, l’heure exacte de la réservation et le nombre de minutes de retard. Ne modifie jamais une réservation ni une table : le responsable valide toute réorganisation.',
    schema: ReportDelaySchema,
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
  {
    name: 'purchaseGiftCard',
    description:
      "Crée une carte cadeau. À appeler uniquement après avoir confirmé : montant (obligatoire), nom de l'expéditeur, téléphone de l'expéditeur (SMS), nom du destinataire. Le code cadeau est envoyé par SMS à l'expéditeur — ne jamais le dicter.",
    schema: PurchaseGiftCardSchema,
  },
  {
    name: 'recommendGiftCardAmount',
    description:
      "Suggère un montant de carte cadeau selon l'occasion et le nombre de personnes. Utiliser quand l'appelant demande un conseil.",
    schema: RecommendGiftCardAmountSchema,
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
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
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

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    };
  }

  return { success: true, data: result.data as Record<string, unknown> };
}
