import type { CallSession, PendingInteractionKind, PendingInteractionStatus } from './types';
import type { TurnPlan, TurnPlanContext, TurnPlanSlot } from './turn-plan';
import { decideTurnPlanPolicy } from './turn-policy';
import { isCurrentVoiceTurn, recordVoiceTurnEventIfCurrent } from './turn-telemetry';
import { getVoiceLlmModel } from '../llm-provider';
import {
  recordVoiceTurnPlanShadowDimension,
  recordVoiceTurnPlanShadowObservation,
  type VoiceTurnPlanShadowPath,
} from '../../../shared/observability/metrics';

export interface TurnPlanPolicySnapshot {
  intent: CallSession['conversation']['intent'];
  slots: CallSession['conversation']['slots'];
  pendingInteractionId: number | null;
  pendingInteractionStatus: PendingInteractionStatus | 'none';
  activeInteractionKind: PendingInteractionKind | 'none';
}

export type InBandTurnPlanResult =
  | { status: 'valid'; plan: TurnPlan; durationMs: number }
  | {
      status: 'invalid' | 'missing' | 'speech_missing' | 'failed' | 'aborted';
      durationMs: number;
    };

export function captureTurnPlanPolicySnapshot(
  session: CallSession,
  pendingInteractionId: number | null,
): TurnPlanPolicySnapshot {
  const pendingInteraction = pendingInteractionId
    ? session.conversation.pendingInteractions.find(
        (interaction) => interaction.id === pendingInteractionId,
      )
    : null;
  const activeInteraction = session.conversation.pendingInteractions.find(
    (interaction) => interaction.status === 'active',
  );
  return {
    intent: session.conversation.intent,
    slots: { ...session.conversation.slots },
    pendingInteractionId,
    pendingInteractionStatus: pendingInteraction?.status ?? 'none',
    activeInteractionKind: activeInteraction?.kind ?? 'none',
  };
}

export function isTurnPlanShadowEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_TURN_PLAN_SHADOW_ENABLED === 'true';
}

function sameSlotValue(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return left === right;
  return left.trim().toLocaleLowerCase('fr-FR') === right.trim().toLocaleLowerCase('fr-FR');
}

function actualInteractionDisposition(status: TurnPlanPolicySnapshot['pendingInteractionStatus']) {
  switch (status) {
    case 'active':
      return 'keep';
    case 'suspended':
      return 'suspend';
    case 'resolved':
      return 'resolve';
    case 'cancelled':
      return 'cancel';
    case 'none':
      return 'none';
  }
}

/** Compare une proposition non autoritaire aux faits et interactions réels après policy. */
export function compareTurnPlanWithPolicy(
  plan: TurnPlan,
  before: TurnPlanPolicySnapshot,
  after: TurnPlanPolicySnapshot,
): {
  agrees: boolean;
  slotAgreement: boolean;
  intentAgreement: boolean;
  interactionAgreement: boolean;
  assistantInteractionAgreement: boolean | null;
  proposedSlotCount: number;
  actualSlotCount: number;
} {
  const slotNames: TurnPlanSlot[] = ['date', 'time', 'partySize', 'customerName', 'customerPhone'];
  const actualChanges = slotNames.filter(
    (slot) => !sameSlotValue(before.slots[slot], after.slots[slot]),
  );
  const proposedChanges = slotNames.filter((slot) => slot in plan.slots);
  const slotAgreement =
    actualChanges.length === proposedChanges.length &&
    proposedChanges.every(
      (slot) => actualChanges.includes(slot) && sameSlotValue(plan.slots[slot], after.slots[slot]),
    );
  const intentAgreement =
    plan.intent === 'unchanged' ? before.intent === after.intent : plan.intent === after.intent;
  const interactionAgreement =
    plan.interactionDisposition === actualInteractionDisposition(after.pendingInteractionStatus);
  const assistantInteractionAgreement =
    plan.assistantInteraction === undefined
      ? null
      : plan.assistantInteraction === after.activeInteractionKind;

  return {
    agrees:
      slotAgreement &&
      intentAgreement &&
      interactionAgreement &&
      assistantInteractionAgreement !== false,
    slotAgreement,
    intentAgreement,
    interactionAgreement,
    assistantInteractionAgreement,
    proposedSlotCount: proposedChanges.length,
    actualSlotCount: actualChanges.length,
  };
}

/** Enregistre l'observation reçue dans la réponse vocale, sans relancer de génération. */
export function recordInBandTurnPlanShadow(
  session: CallSession,
  context: TurnPlanContext,
  result: InBandTurnPlanResult,
  before: TurnPlanPolicySnapshot,
  after: TurnPlanPolicySnapshot,
  turnId: string | undefined,
  path: VoiceTurnPlanShadowPath = 'llm',
): void {
  if (!isTurnPlanShadowEnabled() || !turnId || !isCurrentVoiceTurn(session, turnId)) return;
  const policyDecision =
    result.status === 'valid' ? decideTurnPlanPolicy(context, result.plan) : null;
  const comparison =
    result.status === 'valid' && policyDecision?.status === 'accepted'
      ? compareTurnPlanWithPolicy(result.plan, before, after)
      : null;
  recordVoiceTurnPlanShadowObservation({
    status: result.status,
    policyOutcome: policyDecision?.status ?? 'not_evaluated',
    agreement: comparison ? (comparison.agrees ? 'agree' : 'disagree') : 'not_comparable',
    path,
  });
  if (comparison) {
    recordVoiceTurnPlanShadowDimension('intent', comparison.intentAgreement, path);
    recordVoiceTurnPlanShadowDimension('slots', comparison.slotAgreement, path);
    recordVoiceTurnPlanShadowDimension('interaction', comparison.interactionAgreement, path);
    if (comparison.assistantInteractionAgreement !== null) {
      recordVoiceTurnPlanShadowDimension(
        'assistant_interaction',
        comparison.assistantInteractionAgreement,
        path,
      );
    }
  }
  recordVoiceTurnEventIfCurrent(session, turnId, 'turn_plan_shadow', {
    status: result.status,
    path,
    policyAccepted: policyDecision ? policyDecision.status === 'accepted' : null,
    policyRejectionReason: policyDecision?.status === 'rejected' ? policyDecision.reason : null,
    provider: 'groq',
    model: getVoiceLlmModel(),
    durationMs: result.durationMs,
    agrees: comparison?.agrees ?? null,
    slotAgreement: comparison?.slotAgreement ?? null,
    intentAgreement: comparison?.intentAgreement ?? null,
    interactionAgreement: comparison?.interactionAgreement ?? null,
    assistantInteractionAgreement: comparison?.assistantInteractionAgreement ?? null,
    proposedSlotCount: comparison?.proposedSlotCount ?? null,
    actualSlotCount: comparison?.actualSlotCount ?? null,
    interpretation: result.status === 'valid' ? result.plan.interpretation : null,
    assistantInteraction:
      result.status === 'valid' ? (result.plan.assistantInteraction ?? null) : null,
    confidence: result.status === 'valid' ? result.plan.confidence : null,
  });
}
