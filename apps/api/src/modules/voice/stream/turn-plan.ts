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
export type TurnPlanFactOperation = 'set' | 'replace' | 'clear';
/** Origine déclarée par le modèle, distincte de sa confiance. */
export type TurnPlanFactSource = 'user_explicit' | 'user_tentative' | 'correction';

export interface TurnPlanFact {
  field: TurnPlanSlot;
  op: TurnPlanFactOperation;
  value?: TurnPlanSlotValue;
  source: TurnPlanFactSource;
}

/** Proposition sémantique du modèle, sans capacité d'écriture ni d'action. */
export interface TurnPlan {
  interpretation: TurnPlanInterpretation;
  intent: TurnPlanIntent;
  /**
   * Patches proposés, avec opération et origine. Toujours rempli par
   * `parseTurnPlan` ; absent, les `slots` valent `set` affirmé par l'appelant.
   */
  facts?: TurnPlanFact[];
  /** Valeurs affirmées par l'appelant (set/replace non hésitants), dérivées de `facts`. */
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
const FACT_OPERATIONS = new Set<TurnPlanFactOperation>(['set', 'replace', 'clear']);
const FACT_SOURCES = new Set<TurnPlanFactSource>(['user_explicit', 'user_tentative', 'correction']);
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

function parseFacts(rawFacts: unknown[]): TurnPlanFact[] | null {
  if (rawFacts.length > SLOT_NAMES.size) return null;
  const facts: TurnPlanFact[] = [];
  for (const rawFact of rawFacts) {
    if (!isRecord(rawFact)) return null;
    if (Object.keys(rawFact).some((key) => !['field', 'op', 'value', 'source'].includes(key))) {
      return null;
    }
    const field = rawFact.field as TurnPlanSlot;
    const op = rawFact.op as TurnPlanFactOperation;
    const source = rawFact.source as TurnPlanFactSource;
    if (!SLOT_NAMES.has(field) || !FACT_OPERATIONS.has(op) || !FACT_SOURCES.has(source)) {
      return null;
    }
    // Un champ n'apparaît qu'une fois : deux patches contradictoires sont refusés.
    if (facts.some((fact) => fact.field === field)) return null;
    if (op === 'clear') {
      if (rawFact.value !== undefined) return null;
      facts.push({ field, op, source });
      continue;
    }
    const parsedValue = parseSlotValue(field, rawFact.value);
    if (parsedValue === null) return null;
    facts.push({ field, op, value: parsedValue, source });
  }
  return facts;
}

/** Patches d'un plan, y compris d'un plan construit sans `facts`. */
export function turnPlanFacts(plan: TurnPlan): TurnPlanFact[] {
  return (
    plan.facts ??
    (Object.entries(plan.slots) as Array<[TurnPlanSlot, TurnPlanSlotValue]>).map(
      ([field, value]) => ({ field, op: 'set', value, source: 'user_explicit' }),
    )
  );
}

function parseLegacySlots(rawSlots: Record<string, unknown>): TurnPlanFact[] | null {
  const facts: TurnPlanFact[] = [];
  for (const [rawSlot, rawValue] of Object.entries(rawSlots)) {
    if (!SLOT_NAMES.has(rawSlot as TurnPlanSlot)) return null;
    const field = rawSlot as TurnPlanSlot;
    const parsedValue = parseSlotValue(field, rawValue);
    if (parsedValue === null) return null;
    facts.push({ field, op: 'set', value: parsedValue, source: 'user_explicit' });
  }
  return facts;
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
  if (!isRecord(value)) return null;
  // `facts` est le format courant ; `slots` reste accepté pour les plans
  // antérieurs et vaut alors `set` affirmé par l'appelant. Jamais les deux.
  const hasFacts = value.facts !== undefined;
  const hasSlots = value.slots !== undefined;
  if (hasFacts === hasSlots) return null;
  if (hasFacts && !Array.isArray(value.facts)) return null;
  if (hasSlots && !isRecord(value.slots)) return null;
  const expectedFields = new Set([
    'interpretation',
    'intent',
    'facts',
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

  const facts = hasFacts
    ? parseFacts(value.facts as unknown[])
    : parseLegacySlots(value.slots as Record<string, unknown>);
  if (!facts) return null;
  const slots: TurnPlan['slots'] = {};
  for (const fact of facts) {
    if (fact.op !== 'clear' && fact.source !== 'user_tentative' && fact.value !== undefined) {
      slots[fact.field] = fact.value;
    }
  }
  return {
    interpretation,
    intent,
    facts,
    slots,
    interactionDisposition,
    confidence,
    ...(assistantInteraction !== undefined
      ? { assistantInteraction: assistantInteraction as PendingInteractionKind | 'none' }
      : {}),
  };
}
