import { turnPlanFacts, type TurnPlan } from '../turn-plan';
import type { ConversationState, PendingInteractionKind } from '../types';
import { BEHAVIORS, type BehaviorId } from './behaviors';
import type { SemanticSignals } from './types';

export type Agreement = 'agree' | 'disagree' | 'span_not_observable' | 'not_comparable';
export type SensitiveAction = 'commit' | 'cancellation' | 'human_fallback' | 'gift_card';

export function compareSemanticSignals(
  signals: SemanticSignals,
  plan: TurnPlan | undefined,
  activeInteraction: PendingInteractionKind | 'none',
  currentIntent?: ConversationState['intent'],
  options: { supportsNotObservable?: boolean } = {},
): { agreements: Record<BehaviorId, Agreement>; wouldClarify: SensitiveAction | null } {
  const expected: Partial<Record<BehaviorId, boolean>> = {};
  if (plan) {
    const facts = turnPlanFacts(plan);
    const correction = facts.some((fact) => fact.source === 'correction' || fact.op === 'replace');
    if (correction || plan.interpretation === 'correction') expected.corrects_existing_fact = true;
    else if (plan.interpretation === 'answer' || plan.interpretation === 'new_request')
      expected.corrects_existing_fact = false;
    if (facts.some((fact) => fact.source === 'user_tentative')) expected.fact_is_tentative = true;
    if (plan.interpretation === 'unclear') expected.needs_clarification = true;
    else if (plan.interpretation === 'answer' && plan.confidence === 'high')
      expected.needs_clarification = false;
    if (activeInteraction !== 'none' && plan.interpretation === 'answer')
      expected.answers_active_question = true;
    else if (
      activeInteraction !== 'none' &&
      ['detour_question', 'new_request'].includes(plan.interpretation)
    )
      expected.answers_active_question = false;
    if (
      activeInteraction === 'confirmation' &&
      ['affirmation', 'decline'].includes(plan.interpretation)
    ) {
      expected.explicitly_confirms_proposal = plan.interpretation === 'affirmation';
      expected.rejects_proposal = plan.interpretation === 'decline';
    }
    if (plan.intent === 'cancel' && plan.interpretation === 'new_request') {
      expected.explicitly_requests_cancellation = true;
    }
  }
  const agreements = {} as Record<BehaviorId, Agreement>;
  for (const behavior of BEHAVIORS) {
    const score = signals[behavior.id];
    const planValue = expected[behavior.id];
    agreements[behavior.id] =
      planValue === undefined || !score
        ? 'not_comparable'
        : options.supportsNotObservable !== false && score.notObservable >= 0.5
          ? 'span_not_observable'
          : score.present >= 0.5 === planValue
            ? 'agree'
            : 'disagree';
  }
  const newRequest = plan?.interpretation === 'new_request';
  const resolvedConfirmation =
    activeInteraction === 'confirmation' && plan?.interactionDisposition === 'resolve';
  const confirmationIntent = plan?.intent === 'unchanged' ? currentIntent : plan?.intent;
  const sensitiveAction: SensitiveAction | null =
    (newRequest && plan?.intent === 'cancel') ||
    (resolvedConfirmation && confirmationIntent === 'cancel')
      ? 'cancellation'
      : (newRequest && plan?.intent === 'gift_card') ||
          (resolvedConfirmation && confirmationIntent === 'gift_card')
        ? 'gift_card'
        : resolvedConfirmation
          ? 'commit'
          : activeInteraction === 'humanFallback' && plan?.interactionDisposition === 'resolve'
            ? 'human_fallback'
            : null;
  const matchingProbability =
    sensitiveAction === 'cancellation'
      ? signals.explicitly_requests_cancellation?.present
      : sensitiveAction === 'gift_card'
        ? signals.explicitly_requests_gift_card_purchase?.present
        : sensitiveAction === 'commit'
          ? signals.explicitly_confirms_proposal?.present
          : Math.max(
              signals.explicitly_requests_transfer?.present ?? 0,
              signals.explicitly_requests_message?.present ?? 0,
            );
  const wouldClarify =
    sensitiveAction &&
    ((matchingProbability ?? 0) < 0.5 || (signals.needs_clarification?.present ?? 0) > 0.5)
      ? sensitiveAction
      : null;
  return { agreements, wouldClarify };
}
