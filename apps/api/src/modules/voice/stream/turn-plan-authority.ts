import type { CallSession, PendingInteractionKind, VoiceSpeechAct } from './types';
import type { TurnPlan, TurnPlanContext } from './turn-plan';
import { isTurnPlanShadowEnabled, type TurnPlanPolicySnapshot } from './turn-plan-shadow';
import {
  decideAssistantInteractionPolicy,
  decideTurnPlanPolicy,
  type AssistantInteractionProposal,
} from './turn-policy';
import {
  clearReservationConfirmation,
  finalAssistantQuestion,
  getReservationConfirmationKey,
  isNameCollectionBlocking,
  proposeAssistantInteractionFromLlmText,
  recordAssistantReplyWithPolicy,
} from './conversation-controller';
import { recordVoiceTurnPlanAuthority } from '../../../shared/observability/metrics';

/**
 * Canary d'autorité TurnPlan. Il n'est actif qu'avec le shadow, puisque le plan
 * est collecté par le même appel in-band.
 */
export function isTurnPlanAuthorityEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_TURN_PLAN_AUTHORITY_ENABLED === 'true' && isTurnPlanShadowEnabled(env);
}

/** Le déterministe a-t-il compris ce tour : fait, intention ou interaction résolue ? */
export function hasDeterministicTurnProgress(
  before: TurnPlanPolicySnapshot,
  after: TurnPlanPolicySnapshot,
): boolean {
  return (
    before.intent !== after.intent ||
    (['date', 'time', 'partySize', 'customerName'] as const).some(
      (slot) => before.slots[slot] !== after.slots[slot],
    ) ||
    (after.pendingInteractionStatus !== before.pendingInteractionStatus &&
      after.pendingInteractionStatus === 'resolved')
  );
}

/**
 * Interactions dont le plan ne porte pas les métadonnées ou qui ouvrent une
 * autorisation (récapitulatif, transfert) : elles restent sur l'inférence texte.
 */
const TEXT_ONLY_ASSISTANT_INTERACTIONS = new Set<PendingInteractionKind>([
  'confirmation',
  'humanFallback',
  'partySizeConfirmation',
]);

export type TurnPlanAuthorityFact = 'intent' | 'date' | 'time' | 'partySize';

export interface TurnPlanAuthorityResult {
  appliedFacts: TurnPlanAuthorityFact[];
  assistantInteractionSource: 'turn_plan' | 'llm_text_fallback';
  /** Interaction que l'inférence texte aurait retenue, pour garder un shadow comparable. */
  legacyAssistantInteraction: PendingInteractionKind | 'none';
}

/**
 * Faits du plan accepté par la policy, en complément du déterministe : un champ
 * déjà connu avant le tour, ou posé pendant le tour, n'est jamais remplacé.
 * Une correction exige une opération explicite que le plan ne porte pas encore.
 */
function applyTurnPlanFacts(
  session: CallSession,
  context: TurnPlanContext,
  plan: TurnPlan,
  before: TurnPlanPolicySnapshot,
  speechAct: VoiceSpeechAct,
): TurnPlanAuthorityFact[] {
  if (speechAct !== 'content' && speechAct !== 'correction') return [];
  const decision = decideTurnPlanPolicy(context, plan);
  if (decision.status !== 'accepted') return [];

  const { conversation } = session;
  const applied: TurnPlanAuthorityFact[] = [];
  const { date, time, partySize } = decision.factPatch;
  const facts = [
    ['date', typeof date === 'string' ? date : undefined],
    ['time', typeof time === 'string' ? time : undefined],
    ['partySize', typeof partySize === 'number' ? partySize : undefined],
  ] as const;
  for (const [field, value] of facts) {
    if (value === undefined) continue;
    if (before.slots[field] !== undefined || conversation.slots[field] !== undefined) {
      recordVoiceTurnPlanAuthority(field, 'already_set');
      continue;
    }
    if (field === 'partySize') conversation.slots.partySize = value as number;
    else conversation.slots[field] = value as string;
    applied.push(field);
    recordVoiceTurnPlanAuthority(field, 'applied');
  }
  if (applied.length) {
    // Même invalidation qu'un fait déterministe : le brouillon a changé.
    clearReservationConfirmation(session);
    conversation.offeredAvailability = undefined;
    conversation.lastAvailabilityResult = null;
    conversation.lastAvailabilityCheck = null;
  }

  if (decision.intentPatch) {
    if (before.intent === null && conversation.intent === null) {
      conversation.intent = decision.intentPatch;
      applied.push('intent');
      recordVoiceTurnPlanAuthority('intent', 'applied');
    } else {
      recordVoiceTurnPlanAuthority('intent', 'already_set');
    }
  }
  return applied;
}

function interactionKindOf(
  session: CallSession,
  proposal: AssistantInteractionProposal,
): PendingInteractionKind | 'none' {
  const decision = decideAssistantInteractionPolicy(
    proposal,
    getReservationConfirmationKey(session),
  );
  return decision.status === 'accepted' && decision.operation === 'activate' && decision.interaction
    ? decision.interaction.kind
    : 'none';
}

/** Retourne la proposition du plan, ou null quand l'inférence texte doit rester l'autorité. */
function proposeAssistantInteractionFromTurnPlan(
  session: CallSession,
  plan: TurnPlan,
  reply: string,
  legacyKind: PendingInteractionKind | 'none',
): AssistantInteractionProposal | null {
  const kind = plan.assistantInteraction;
  if (kind === undefined || isNameCollectionBlocking(session)) return null;
  if (legacyKind !== 'none' && TEXT_ONLY_ASSISTANT_INTERACTIONS.has(legacyKind)) return null;
  const question = finalAssistantQuestion(reply);
  if (kind === 'none') {
    // Une réponse qui se termine par une question attend forcément quelque chose.
    return question ? null : { source: 'turn_plan', operation: 'cancel' };
  }
  if (TEXT_ONLY_ASSISTANT_INTERACTIONS.has(kind)) return null;
  return {
    source: 'turn_plan',
    operation: 'activate',
    interaction: { kind, prompt: question ?? reply },
  };
}

/**
 * Applique un TurnPlan valide après la réponse vocale : faits non sensibles en
 * complément du déterministe, puis interaction attendue. Les tools et
 * confirmations restent sous la policy existante.
 */
export function applyTurnPlanAuthority(
  session: CallSession,
  input: {
    context: TurnPlanContext;
    plan: TurnPlan;
    before: TurnPlanPolicySnapshot;
    speechAct: VoiceSpeechAct;
    reply: string;
  },
): TurnPlanAuthorityResult {
  const appliedFacts = applyTurnPlanFacts(
    session,
    input.context,
    input.plan,
    input.before,
    input.speechAct,
  );
  const legacyProposal = proposeAssistantInteractionFromLlmText(session, input.reply);
  const legacyAssistantInteraction = interactionKindOf(session, legacyProposal);
  const planProposal =
    decideTurnPlanPolicy(input.context, input.plan).status === 'accepted'
      ? proposeAssistantInteractionFromTurnPlan(
          session,
          input.plan,
          input.reply,
          legacyAssistantInteraction,
        )
      : null;
  recordAssistantReplyWithPolicy(session, input.reply, planProposal ?? legacyProposal);
  recordVoiceTurnPlanAuthority(
    'assistant_interaction',
    planProposal ? 'applied' : 'deterministic_fallback',
  );
  return {
    appliedFacts,
    assistantInteractionSource: planProposal ? 'turn_plan' : 'llm_text_fallback',
    legacyAssistantInteraction,
  };
}
