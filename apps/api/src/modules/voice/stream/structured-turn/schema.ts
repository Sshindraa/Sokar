/**
 * Sortie structurée d'un tour vocal : le modèle comprend le tour, tient le
 * brouillon de réservation, choisit une action et formule sa réponse, en un seul
 * appel. Le code ne classe rien lui-même : il valide ces champs et exécute les
 * actions autorisées.
 *
 * L'ordre des clés est celui du schéma (Cerebras, mode strict) : `say` vient en
 * dernier pour être lu en streaming pendant sa génération ; `turnComplete` en
 * premier pour savoir au plus tôt si l'appelant a fini de parler.
 */

export const STRUCTURED_TURN_INTERPRETATIONS = [
  'answer',
  'question',
  'correction',
  'affirmation',
  'decline',
  'new_request',
  'end_call',
  'unclear',
] as const;

export const STRUCTURED_TURN_AWAITING = [
  'none',
  'date',
  'time',
  'partySize',
  'customerName',
  'customerNameConfirmation',
  'confirmation',
  'humanFallback',
  'open',
] as const;

export const STRUCTURED_TURN_ACTIONS = [
  'none',
  'check_availability',
  'create_reservation',
  'take_message',
  'transfer',
  'end_call',
] as const;

export type StructuredTurnInterpretation = (typeof STRUCTURED_TURN_INTERPRETATIONS)[number];
export type StructuredTurnAwaiting = (typeof STRUCTURED_TURN_AWAITING)[number];
export type StructuredTurnAction = (typeof STRUCTURED_TURN_ACTIONS)[number];

/** Brouillon tenu par le modèle ; chaîne vide ou 0 = inconnu. */
export interface StructuredTurnDraft {
  date: string;
  time: string;
  partySize: number;
  customerName: string;
}

export interface StructuredTurnOutput {
  /** Faux quand l'appelant n'a visiblement pas fini sa phrase : l'agent se tait. */
  turnComplete: boolean;
  interpretation: StructuredTurnInterpretation;
  draft: StructuredTurnDraft;
  awaiting: StructuredTurnAwaiting;
  action: StructuredTurnAction;
  message: string;
  confidence: 'high' | 'medium' | 'low';
  say: string;
}

export const STRUCTURED_TURN_SCHEMA_NAME = 'voice_turn';

/**
 * Schéma JSON strict. `actions` restreint les actions possibles : après une
 * action exécutée, le second passage ne peut que parler ou terminer l'appel.
 */
export function buildStructuredTurnJsonSchema(
  actions: readonly StructuredTurnAction[] = STRUCTURED_TURN_ACTIONS,
) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      turnComplete: { type: 'boolean' },
      interpretation: { type: 'string', enum: [...STRUCTURED_TURN_INTERPRETATIONS] },
      draft: {
        type: 'object',
        additionalProperties: false,
        properties: {
          date: { type: 'string' },
          time: { type: 'string' },
          partySize: { type: 'integer' },
          customerName: { type: 'string' },
        },
        required: ['date', 'time', 'partySize', 'customerName'],
      },
      awaiting: { type: 'string', enum: [...STRUCTURED_TURN_AWAITING] },
      action: { type: 'string', enum: [...actions] },
      message: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      say: { type: 'string' },
    },
    required: [
      'turnComplete',
      'interpretation',
      'draft',
      'awaiting',
      'action',
      'message',
      'confidence',
      'say',
    ],
  } as const;
}

function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

/** Valide la forme ; les valeurs métier sont vérifiées par les garde-fous. */
export function parseStructuredTurnOutput(raw: string): StructuredTurnOutput | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const draft = record.draft as Record<string, unknown> | undefined;
  if (
    typeof record.turnComplete !== 'boolean' ||
    !isOneOf(STRUCTURED_TURN_INTERPRETATIONS, record.interpretation) ||
    !isOneOf(STRUCTURED_TURN_AWAITING, record.awaiting) ||
    !isOneOf(STRUCTURED_TURN_ACTIONS, record.action) ||
    !isOneOf(['high', 'medium', 'low'] as const, record.confidence) ||
    typeof record.say !== 'string' ||
    typeof record.message !== 'string' ||
    typeof draft !== 'object' ||
    draft === null ||
    typeof draft.date !== 'string' ||
    typeof draft.time !== 'string' ||
    typeof draft.partySize !== 'number' ||
    typeof draft.customerName !== 'string'
  ) {
    return null;
  }
  return {
    turnComplete: record.turnComplete,
    interpretation: record.interpretation,
    draft: {
      date: draft.date,
      time: draft.time,
      partySize: draft.partySize,
      customerName: draft.customerName,
    },
    awaiting: record.awaiting,
    action: record.action,
    message: record.message,
    confidence: record.confidence,
    say: record.say,
  };
}
