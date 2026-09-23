import type { ConversationState, PendingInteractionKind } from './types';

export type TurnPlanInterpretation =
  | 'answer'
  | 'detour_question'
  | 'correction'
  | 'affirmation'
  | 'decline'
  | 'new_request'
  | 'unclear';

export type TurnPlanSlot = 'date' | 'time' | 'partySize' | 'customerName' | 'customerPhone';
export type TurnPlanInteractionDisposition = 'resolve' | 'suspend' | 'keep' | 'cancel' | 'none';
export type TurnPlanIntent = NonNullable<ConversationState['intent']> | 'unchanged';

export type TurnPlanSlotValue = string | number;

/** Proposition sémantique du modèle, sans capacité d'écriture ni d'action. */
export interface TurnPlan {
  interpretation: TurnPlanInterpretation;
  intent: TurnPlanIntent;
  slots: Partial<Record<TurnPlanSlot, TurnPlanSlotValue>>;
  interactionDisposition: TurnPlanInteractionDisposition;
  confidence: 'high' | 'medium' | 'low';
  /** What the assistant's final user-facing question asks next, observed in-band. */
  assistantInteraction?: PendingInteractionKind | 'none';
}

export interface TurnPlanContext {
  transcript: string;
  language: string;
  timezone: string;
  referenceTime: string;
  intent: ConversationState['intent'];
  pendingInteraction: {
    kind: PendingInteractionKind;
    intentContext?: ConversationState['intent'];
    fallbackMode?: 'choice' | 'transfer' | 'message';
    candidatePartySize?: number;
  } | null;
  slots: Pick<ConversationState['slots'], 'date' | 'time' | 'partySize'>;
  hasConfirmedName: boolean;
}

const INTERPRETATIONS = new Set<TurnPlanInterpretation>([
  'answer',
  'detour_question',
  'correction',
  'affirmation',
  'decline',
  'new_request',
  'unclear',
]);
const INTENTS = new Set<TurnPlanIntent>([
  'reservation',
  'availability',
  'cancel',
  'delay',
  'message',
  'gift_card',
  'unchanged',
]);
const INTERACTION_DISPOSITIONS = new Set<TurnPlanInteractionDisposition>([
  'resolve',
  'suspend',
  'keep',
  'cancel',
  'none',
]);
const CONFIDENCE = new Set<TurnPlan['confidence']>(['high', 'medium', 'low']);
const SLOT_NAMES = new Set<TurnPlanSlot>([
  'date',
  'time',
  'partySize',
  'customerName',
  'customerPhone',
]);
const ASSISTANT_INTERACTIONS = new Set<PendingInteractionKind | 'none'>([
  'date',
  'time',
  'timeChoice',
  'partySize',
  'partySizeConfirmation',
  'customerName',
  'customerPhone',
  'confirmation',
  'humanFallback',
  'open',
  'none',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseSlotValue(slot: TurnPlanSlot, value: unknown): TurnPlanSlotValue | null {
  if (slot === 'date') return isValidDate(value) ? value : null;
  if (slot === 'time') {
    return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
  }
  if (slot === 'partySize') {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 7
      ? value
      : null;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > 160) return null;
  return normalized;
}

/** Valide et borne strictement une proposition JSON non fiable du modèle. */
export function parseTurnPlan(
  raw: string,
  options: { requireAssistantInteraction?: boolean } = {},
): TurnPlan | null {
  const json = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.slots)) return null;
  const expectedFields = new Set([
    'interpretation',
    'intent',
    'slots',
    'interactionDisposition',
    'confidence',
    'assistantInteraction',
  ]);
  if (Object.keys(value).some((field) => !expectedFields.has(field))) return null;

  const interpretation = value.interpretation as TurnPlanInterpretation;
  const intent = value.intent as TurnPlanIntent;
  const interactionDisposition = value.interactionDisposition as TurnPlanInteractionDisposition;
  const confidence = value.confidence as TurnPlan['confidence'];
  if (
    !INTERPRETATIONS.has(interpretation) ||
    !INTENTS.has(intent) ||
    !INTERACTION_DISPOSITIONS.has(interactionDisposition) ||
    !CONFIDENCE.has(confidence)
  ) {
    return null;
  }
  const assistantInteraction = value.assistantInteraction;
  if (
    (options.requireAssistantInteraction &&
      !ASSISTANT_INTERACTIONS.has(assistantInteraction as PendingInteractionKind | 'none')) ||
    (assistantInteraction !== undefined &&
      !ASSISTANT_INTERACTIONS.has(assistantInteraction as PendingInteractionKind | 'none'))
  ) {
    return null;
  }

  const slots: TurnPlan['slots'] = {};
  for (const [rawSlot, rawValue] of Object.entries(value.slots)) {
    if (!SLOT_NAMES.has(rawSlot as TurnPlanSlot)) return null;
    const slot = rawSlot as TurnPlanSlot;
    const parsedValue = parseSlotValue(slot, rawValue);
    if (parsedValue === null) return null;
    slots[slot] = parsedValue;
  }
  return {
    interpretation,
    intent,
    slots,
    interactionDisposition,
    confidence,
    ...(assistantInteraction !== undefined
      ? { assistantInteraction: assistantInteraction as PendingInteractionKind | 'none' }
      : {}),
  };
}
