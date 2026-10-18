import type {
  ConversationState,
  PendingInteractionKind,
  PendingQuestion,
  VoiceSpeechAct,
} from './types';
import { turnPlanFacts, type TurnPlan, type TurnPlanContext } from './turn-plan';
import { AssistantInteractionProposal } from './voice-action-policy';

export type PartySizeEvidence = 'explicit' | 'contextual' | 'confirmation' | 'none';

export interface DeterministicTurnProposal {
  intent: ConversationState['intent'];
  slots: Partial<Pick<ConversationState['slots'], 'date' | 'time' | 'partySize'>>;
  partySizeEvidence: PartySizeEvidence;
  customerName: string | null;
  wantsAvailabilityOptions: boolean;
}

export interface TurnPolicyContext {
  speechAct: VoiceSpeechAct;
  intent: ConversationState['intent'];
  slots: ConversationState['slots'];
  customerName: string | undefined;
  activeInteractionKind: PendingQuestion;
  activeInteractionCandidatePartySize?: number;
}

export interface TurnPolicyDecision {
  disposition: 'ignore' | 'apply' | 'close';
  intent?: NonNullable<ConversationState['intent']>;
  slots: DeterministicTurnProposal['slots'];
  customerName?: string;
  wantsAvailabilityOptions: boolean;
  clearReservationConfirmation: boolean;
  invalidateAvailability: boolean;
  resolveInteraction?: PendingInteractionKind;
  progressed: boolean;
}

export type AssistantInteractionPolicyDecision =
  | {
      status: 'accepted';
      operation: AssistantInteractionProposal['operation'];
      interaction?: AssistantInteractionProposal['interaction'];
      clearReservationConfirmation: boolean;
      pendingReservationConfirmationKey: string | null;
    }
  | {
      status: 'rejected';
      operation: 'cancel';
      clearReservationConfirmation: true;
      pendingReservationConfirmationKey: null;
      rejectionReason: 'missing_interaction' | 'invalid_prompt' | 'invalid_metadata';
    };

export type TurnPlanRejectionReason =
  | 'low_confidence'
  | 'pending_interaction_mismatch'
  | 'unclear_with_facts'
  | 'unsafe_affirmation'
  | 'unsupported_phone_slot';

export type TurnPlanPolicyDecision =
  | {
      status: 'accepted';
      intentPatch: NonNullable<ConversationState['intent']> | null;
      factPatch: TurnPlan['slots'];
      interactionDisposition: TurnPlan['interactionDisposition'];
      allowedTools: readonly [];
    }
  | { status: 'rejected'; reason: TurnPlanRejectionReason; allowedTools: readonly [] };

/** Pure validation and authorization for model output; it never sees a session reference. */
export function decideTurnPlanPolicy(
  context: TurnPlanContext,
  plan: TurnPlan,
): TurnPlanPolicyDecision {
  if (plan.confidence !== 'high') {
    return { status: 'rejected', reason: 'low_confidence', allowedTools: [] };
  }

  const hasPendingInteraction = context.pendingInteraction !== null;
  if (
    (!hasPendingInteraction && plan.interactionDisposition !== 'none') ||
    (hasPendingInteraction && plan.interactionDisposition === 'none')
  ) {
    return { status: 'rejected', reason: 'pending_interaction_mismatch', allowedTools: [] };
  }

  const facts = turnPlanFacts(plan);
  if (plan.interpretation === 'unclear' && (plan.intent !== 'unchanged' || facts.length)) {
    return { status: 'rejected', reason: 'unclear_with_facts', allowedTools: [] };
  }
  if (facts.some((fact) => fact.field === 'customerPhone')) {
    return { status: 'rejected', reason: 'unsupported_phone_slot', allowedTools: [] };
  }

  const pending = context.pendingInteraction;
  if (plan.interpretation === 'affirmation' && pending) {
    if (pending.kind === 'humanFallback' && pending.fallbackMode === 'choice') {
      if (plan.interactionDisposition !== 'keep' || Object.keys(plan.slots).length > 0) {
        return { status: 'rejected', reason: 'unsafe_affirmation', allowedTools: [] };
      }
    }
    if (pending.kind === 'partySizeConfirmation') {
      if (
        pending.candidatePartySize === undefined ||
        plan.slots.partySize !== pending.candidatePartySize ||
        plan.interactionDisposition !== 'resolve'
      ) {
        return { status: 'rejected', reason: 'unsafe_affirmation', allowedTools: [] };
      }
    }
    if (pending.kind === 'confirmation' && Object.keys(plan.slots).length > 0) {
      return { status: 'rejected', reason: 'unsafe_affirmation', allowedTools: [] };
    }
  }

  return {
    status: 'accepted',
    intentPatch: plan.intent === 'unchanged' || plan.intent === context.intent ? null : plan.intent,
    factPatch: { ...plan.slots },
    interactionDisposition: plan.interactionDisposition,
    // TurnPlans never authorize tools. Existing explicit confirmation and transfer
    // policy remains the only path to external effects.
    allowedTools: [],
  };
}

/** Policy gate for a response's proposed pending interaction and confirmation key. */
export function decideAssistantInteractionPolicy(
  proposal: AssistantInteractionProposal,
  currentReservationConfirmationKey: string | null,
): AssistantInteractionPolicyDecision {
  if (proposal.operation === 'activate' && !proposal.interaction) {
    return {
      status: 'rejected',
      operation: 'cancel',
      clearReservationConfirmation: true,
      pendingReservationConfirmationKey: null,
      rejectionReason: 'missing_interaction',
    };
  }

  const interaction = proposal.interaction;
  if (interaction) {
    if (!interaction.prompt.trim() || interaction.prompt.length > 1_000) {
      return {
        status: 'rejected',
        operation: 'cancel',
        clearReservationConfirmation: true,
        pendingReservationConfirmationKey: null,
        rejectionReason: 'invalid_prompt',
      };
    }
    if (
      (interaction.kind === 'humanFallback') !== (interaction.fallbackMode !== undefined) ||
      (interaction.kind === 'partySizeConfirmation' &&
        (interaction.candidatePartySize === undefined ||
          !Number.isInteger(interaction.candidatePartySize) ||
          interaction.candidatePartySize < 1 ||
          interaction.candidatePartySize > 100)) ||
      (interaction.kind !== 'partySizeConfirmation' && interaction.candidatePartySize !== undefined)
    ) {
      return {
        status: 'rejected',
        operation: 'cancel',
        clearReservationConfirmation: true,
        pendingReservationConfirmationKey: null,
        rejectionReason: 'invalid_metadata',
      };
    }
  }

  const pendingReservationConfirmationKey =
    proposal.operation === 'keep'
      ? currentReservationConfirmationKey
      : proposal.operation === 'activate' && interaction?.kind === 'confirmation'
        ? currentReservationConfirmationKey
        : null;
  return {
    status: 'accepted',
    operation: proposal.operation,
    ...(interaction ? { interaction } : {}),
    clearReservationConfirmation:
      proposal.operation === 'cancel' ||
      (proposal.operation === 'activate' && interaction?.kind !== 'confirmation'),
    pendingReservationConfirmationKey,
  };
}

function sameName(left: string | undefined, right: string): boolean {
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase('fr-FR')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[’']/gu, ' ')
      .replace(/[^\p{L}\p{N}:\s-]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  return normalize(left ?? '') === normalize(right);
}

/**
 * Borne de cohérence seulement : le seuil du restaurant (`voiceMaxPartySize`)
 * est appliqué avant la policy, qui ne voit jamais un groupe au-delà.
 */
function isValidPartySize(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 100;
}

function interactionFulfilled(
  kind: PendingQuestion,
  slots: TurnPolicyDecision['slots'],
  customerNameProvided: boolean,
): PendingInteractionKind | undefined {
  if (!kind) return undefined;
  switch (kind) {
    case 'date':
      return slots.date !== undefined ? kind : undefined;
    case 'time':
    case 'timeChoice':
      return slots.time !== undefined ? kind : undefined;
    case 'partySize':
    case 'partySizeConfirmation':
      return slots.partySize !== undefined ? kind : undefined;
    case 'customerName':
      return customerNameProvided ? kind : undefined;
    default:
      return undefined;
  }
}

/**
 * Unique authorization point for semantic facts proposed for a user turn.
 * Model TurnPlans are deliberately not inputs while they are in shadow mode.
 */
export function decideTurnPolicy(
  context: TurnPolicyContext,
  proposal: DeterministicTurnProposal,
): TurnPolicyDecision {
  if (context.speechAct === 'closing') {
    return {
      disposition: 'close',
      slots: {},
      wantsAvailabilityOptions: false,
      clearReservationConfirmation: true,
      invalidateAvailability: false,
      progressed: false,
    };
  }

  if (context.speechAct !== 'content' && context.speechAct !== 'correction') {
    return {
      disposition: 'ignore',
      slots: {},
      wantsAvailabilityOptions: false,
      clearReservationConfirmation: false,
      invalidateAvailability: false,
      progressed: false,
    };
  }

  const slots: TurnPolicyDecision['slots'] = {};
  if (proposal.slots.date !== undefined) slots.date = proposal.slots.date;
  if (proposal.slots.time !== undefined) slots.time = proposal.slots.time;

  const partySize = proposal.slots.partySize;
  const acceptsExplicitPartySize = proposal.partySizeEvidence === 'explicit';
  const acceptsContextualPartySize =
    proposal.partySizeEvidence === 'contextual' &&
    (context.activeInteractionKind === 'partySize' ||
      context.activeInteractionKind === 'partySizeConfirmation');
  const acceptsPartySizeConfirmation =
    proposal.partySizeEvidence === 'confirmation' &&
    context.activeInteractionKind === 'partySizeConfirmation' &&
    isValidPartySize(context.activeInteractionCandidatePartySize) &&
    partySize === context.activeInteractionCandidatePartySize;
  if (
    isValidPartySize(partySize) &&
    (acceptsExplicitPartySize || acceptsContextualPartySize || acceptsPartySizeConfirmation)
  ) {
    slots.partySize = partySize;
  }

  const customerName =
    proposal.customerName && !sameName(context.customerName, proposal.customerName)
      ? proposal.customerName
      : undefined;
  const customerNameProvided = proposal.customerName !== null;
  const coreSlotChanged = (['date', 'time', 'partySize'] as const).some(
    (slot) => slots[slot] !== undefined && slots[slot] !== context.slots[slot],
  );
  const customerNameChanged = customerName !== undefined;
  const wantsAvailabilityOptions = proposal.wantsAvailabilityOptions;
  const intent =
    proposal.intent ?? (wantsAvailabilityOptions && !context.intent ? 'availability' : undefined);
  const resolveInteraction = interactionFulfilled(
    context.activeInteractionKind,
    slots,
    customerNameProvided,
  );
  const progressed = coreSlotChanged || customerNameChanged || wantsAvailabilityOptions;

  return {
    disposition: 'apply',
    ...(intent ? { intent } : {}),
    slots,
    ...(customerName ? { customerName } : {}),
    wantsAvailabilityOptions,
    clearReservationConfirmation:
      context.speechAct === 'correction' || coreSlotChanged || customerNameChanged,
    invalidateAvailability: coreSlotChanged,
    ...(resolveInteraction ? { resolveInteraction } : {}),
    progressed,
  };
}
