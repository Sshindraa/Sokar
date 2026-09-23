import type {
  ConversationState,
  HumanFallbackMode,
  PendingInteractionKind,
  PendingQuestion,
  VoiceSpeechAct,
} from './types';
import type { TurnPlan, TurnPlanContext } from './turn-plan';

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

export interface AssistantInteractionProposal {
  source: 'explicit' | 'llm_text_fallback' | 'turn_plan';
  operation: 'activate' | 'keep' | 'cancel';
  interaction?: {
    kind: PendingInteractionKind;
    prompt: string;
    fallbackMode?: Exclude<HumanFallbackMode, null>;
    candidatePartySize?: number;
  };
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

export type VoiceToolAuthorizationBasis =
  | { kind: 'human_fallback_choice'; choice: 'transfer' | 'message' }
  | { kind: 'name_spelling_escalation' };

export type VoiceToolDenialReason =
  | 'confirmation_required'
  | 'name_confirmation_required'
  | 'explicit_transfer_required'
  | 'manager_unconfigured'
  | 'explicit_message_required'
  | 'intent_required'
  | 'unknown_tool';

export interface VoiceToolPolicyContext {
  toolName: string;
  args: Record<string, unknown>;
  lastUserUtterance: string;
  intent: ConversationState['intent'];
  slots: ConversationState['slots'];
  lastAvailabilityResult: ConversationState['lastAvailabilityResult'];
  currentReservationKey: string | null;
  authorizedReservationKey: string | null;
  nameCollectionBlocked: boolean;
  managerConfigured: boolean;
  pendingInteraction: {
    kind: PendingInteractionKind;
    intentContext?: ConversationState['intent'];
    fallbackMode?: Exclude<HumanFallbackMode, null>;
  } | null;
  authorizationBasis?: VoiceToolAuthorizationBasis;
}

export type VoiceToolPolicyDecision =
  | { status: 'allowed' }
  | { status: 'denied'; reason: VoiceToolDenialReason };

function normalizePolicyTranscript(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/gu, ' ')
    .replace(/[^\p{L}\p{N}:\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isPolicyAffirmative(value: string): boolean {
  return /^(?:oui|ouais|ok(?:ay)?|d accord|dac|bien sur|exactement|tout a fait|ca marche|c est bon|c est bien ca|c est ca|ca me va|parfait|je confirme|yes|yeah|yep|sure|right|correct|alright)$/.test(
    normalizePolicyTranscript(value),
  );
}

function explicitlyDeclinesAction(value: string, action: RegExp): boolean {
  const transcript = normalizePolicyTranscript(value);
  const hasNegation =
    /\b(?:je )?ne (?:veux|voudrais|souhaite|souhaiterais|peux|dois|vais) (?:pas|plus)\b/.test(
      transcript,
    ) || /\b(?:j ai )?pas envie de\b/.test(transcript);
  return hasNegation && action.test(transcript);
}

function explicitlyRequestsTransfer(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (
    explicitlyDeclinesAction(value, /(?:gerant|manager|transfert|transfer|passe\w*|mette\w*)/) ||
    /\b(?:ne|n) (?:me )?(?:passe\w*|mette\w*|transfere\w*) pas\b/.test(transcript) ||
    /\bpas besoin\b.*\b(?:gerant|manager|transfert|transfer)\b/.test(transcript)
  ) {
    return false;
  }
  return (
    /\b(?:passez? moi|mettez? moi en relation|transferez? moi|joindre le gerant|parler (?:au|avec le) gerant|put me through|connect me to|transfer me)\b/.test(
      transcript,
    ) ||
    /\bje (?:veux|voudrais|souhaite|souhaiterais) (?:parler au|joindre|etre mis en relation avec) (?:le )?gerant\b/.test(
      transcript,
    ) ||
    /^(?:(?:le )?(?:gerant|manager|transfert|transfer))(?: s il vous plait)?$/.test(transcript)
  );
}

function explicitlyRequestsMessage(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (
    explicitlyDeclinesAction(value, /(?:message|rappel|callback)/) ||
    /\bne (?:prenez|prends|laissez|laisse) pas (?:un )?message\b/.test(transcript) ||
    /\bpas besoin\b.*\bmessage\b/.test(transcript)
  ) {
    return false;
  }
  return (
    /\b(?:prenez|prends|prendre|laissez|laisser) (?:un )?message\b/.test(transcript) ||
    /\bje (?:veux|voudrais|souhaite|peux|aimerais) (?:vous )?(?:laisser|prendre) (?:un )?message\b/.test(
      transcript,
    ) ||
    /^(?:(?:un )?message|rappel|rappelez moi|leave a message|take a message|call me back)$/.test(
      transcript,
    )
  );
}

function explicitlyDeclinesCancellation(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  return (
    explicitlyDeclinesAction(value, /(?:annul\w*|supprim\w*|cancel\w*)/) ||
    /\b(?:ne|n) (?:me )?(?:annul\w*|supprim\w*|cancel\w*) pas\b/.test(transcript) ||
    /\bpas besoin\b.*\b(?:annul\w*|supprim\w*|cancel\w*)/.test(transcript)
  );
}

function explicitlyRequestsCancellation(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (explicitlyDeclinesCancellation(value)) return false;
  return /\b(?:annul\w*|supprim\w*|cancel\w*)/.test(transcript);
}

function explicitlyDeclinesDelay(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  return (
    explicitlyDeclinesAction(value, /(?:retard|late|delay)/) ||
    /\b(?:pas|aucun|aucune|sans|jamais)\b.{0,30}\b(?:retard|late|delay)\b/.test(transcript) ||
    /\b(?:ne|n) [\p{L}]+ pas\b.{0,40}\b(?:retard|late|delay)\b/u.test(transcript)
  );
}

function explicitlyReportsDelay(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (explicitlyDeclinesDelay(value)) return false;
  return /\b(?:retard|late|delay)\b/.test(transcript);
}

function explicitlyRequestsGiftCardPurchase(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (
    explicitlyDeclinesAction(value, /(?:carte cadeau|bon cadeau|gift card|gift voucher)/) ||
    /\b(?:ne|n) (?:achete\w*|commande\w*|prends|prenne|offre\w*) pas\b.*\b(?:carte cadeau|bon cadeau|gift card|gift voucher)\b/.test(
      transcript,
    ) ||
    /\bpas besoin\b.*\b(?:carte cadeau|bon cadeau|gift card|gift voucher)\b/.test(transcript)
  ) {
    return false;
  }
  return /\b(?:achete\w*|commande\w*|prends|prendre|offrir|je veux|je voudrais|je souhaite)\b.{0,60}\b(?:carte cadeau|bon cadeau|gift card|gift voucher)\b/.test(
    transcript,
  );
}

function isPendingIntentFollowup(
  context: VoiceToolPolicyContext,
  intent: NonNullable<ConversationState['intent']>,
  allowedKinds: readonly PendingInteractionKind[],
): boolean {
  const pending = context.pendingInteraction;
  return Boolean(
    context.intent === intent &&
    pending?.intentContext === intent &&
    allowedKinds.includes(pending.kind),
  );
}

/** Central authorization for voice tools; TurnPlans themselves never grant a permit. */
export function authorizeVoiceTool(context: VoiceToolPolicyContext): VoiceToolPolicyDecision {
  const { toolName, args } = context;
  switch (toolName) {
    case 'checkAvailability':
    case 'recommendGiftCardAmount':
      return { status: 'allowed' };

    case 'createReservation': {
      if (context.nameCollectionBlocked) {
        return { status: 'denied', reason: 'name_confirmation_required' };
      }
      const { date, time, partySize } = args;
      const key = `${String(date)}:${String(time)}:${String(partySize)}`;
      const draftMatches =
        context.currentReservationKey !== null &&
        context.authorizedReservationKey === context.currentReservationKey &&
        context.slots.date === date &&
        context.slots.time === time &&
        context.slots.partySize === partySize &&
        context.lastAvailabilityResult?.key === key &&
        Boolean(context.lastAvailabilityResult.slots.includes(String(time)));
      return draftMatches
        ? { status: 'allowed' }
        : { status: 'denied', reason: 'confirmation_required' };
    }

    case 'handoffToManager': {
      if (!context.managerConfigured) return { status: 'denied', reason: 'manager_unconfigured' };
      const selectedByPolicy =
        context.authorizationBasis?.kind === 'human_fallback_choice' &&
        context.authorizationBasis.choice === 'transfer';
      const selectedInPendingInteraction =
        context.pendingInteraction?.kind === 'humanFallback' &&
        context.pendingInteraction.fallbackMode === 'transfer' &&
        isPolicyAffirmative(context.lastUserUtterance);
      return selectedByPolicy ||
        selectedInPendingInteraction ||
        explicitlyRequestsTransfer(context.lastUserUtterance)
        ? { status: 'allowed' }
        : { status: 'denied', reason: 'explicit_transfer_required' };
    }

    case 'takeMessage': {
      const selectedByPolicy =
        context.authorizationBasis?.kind === 'human_fallback_choice' &&
        context.authorizationBasis.choice === 'message';
      const nameSpellingEscalation =
        context.authorizationBasis?.kind === 'name_spelling_escalation';
      const selectedInPendingInteraction =
        context.pendingInteraction?.kind === 'humanFallback' &&
        context.pendingInteraction.fallbackMode === 'message' &&
        isPolicyAffirmative(context.lastUserUtterance);
      return selectedByPolicy ||
        nameSpellingEscalation ||
        selectedInPendingInteraction ||
        explicitlyRequestsMessage(context.lastUserUtterance)
        ? { status: 'allowed' }
        : { status: 'denied', reason: 'explicit_message_required' };
    }

    case 'cancelReservation':
      return !explicitlyDeclinesCancellation(context.lastUserUtterance) &&
        (explicitlyRequestsCancellation(context.lastUserUtterance) ||
          isPendingIntentFollowup(context, 'cancel', [
            'date',
            'time',
            'timeChoice',
            'customerName',
            'customerPhone',
            'confirmation',
          ]))
        ? { status: 'allowed' }
        : { status: 'denied', reason: 'intent_required' };

    case 'reportDelay':
      return !explicitlyDeclinesDelay(context.lastUserUtterance) &&
        (explicitlyReportsDelay(context.lastUserUtterance) ||
          isPendingIntentFollowup(context, 'delay', [
            'date',
            'time',
            'timeChoice',
            'customerName',
            'customerPhone',
            'confirmation',
          ]))
        ? { status: 'allowed' }
        : { status: 'denied', reason: 'intent_required' };

    case 'purchaseGiftCard': {
      const purchaseConfirmation =
        context.pendingInteraction?.kind === 'confirmation' &&
        context.pendingInteraction.intentContext === 'gift_card' &&
        isPolicyAffirmative(context.lastUserUtterance);
      return explicitlyRequestsGiftCardPurchase(context.lastUserUtterance) || purchaseConfirmation
        ? { status: 'allowed' }
        : { status: 'denied', reason: 'intent_required' };
    }

    default:
      return { status: 'denied', reason: 'unknown_tool' };
  }
}

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

  if (
    plan.interpretation === 'unclear' &&
    (plan.intent !== 'unchanged' || Object.keys(plan.slots).length)
  ) {
    return { status: 'rejected', reason: 'unclear_with_facts', allowedTools: [] };
  }
  if ('customerPhone' in plan.slots) {
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
          interaction.candidatePartySize > 7)) ||
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

function isValidPartySize(value: number | undefined): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 1 && value <= 7;
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
