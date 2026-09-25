import type { CallSession, PendingInteractionKind, VoiceSpeechAct } from './types';
import { turnPlanFacts, type TurnPlan, type TurnPlanContext } from './turn-plan';
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
  voiceMaxPartySize,
} from './conversation-controller';
import { recordVoiceTurnPlanAuthority } from '../../../shared/observability/metrics';

/**
 * Canary d'autorité TurnPlan. Il n'est actif qu'avec le shadow, puisque le plan
 * est collecté par le même appel in-band, et seulement pour les restaurants
 * listés explicitement (`*` pour tous) : le shadow observe partout, l'autorité
 * décide d'abord sur un pilote.
 */
export function isTurnPlanAuthorityEnabled(
  restaurantId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.VOICE_TURN_PLAN_AUTHORITY_ENABLED !== 'true' || !isTurnPlanShadowEnabled(env)) {
    return false;
  }
  const allowlist = (env.VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  return allowlist.includes('*') || (Boolean(restaurantId) && allowlist.includes(restaurantId!));
}

/** Un fait ou l'intention a-t-il changé pendant le tour ? */
export function hasTurnFactProgress(
  before: TurnPlanPolicySnapshot,
  after: TurnPlanPolicySnapshot,
): boolean {
  return (
    before.intent !== after.intent ||
    (['date', 'time', 'partySize', 'customerName'] as const).some(
      (slot) => before.slots[slot] !== after.slots[slot],
    )
  );
}

/** Le déterministe a-t-il compris ce tour : fait, intention ou interaction résolue ? */
export function hasDeterministicTurnProgress(
  before: TurnPlanPolicySnapshot,
  after: TurnPlanPolicySnapshot,
): boolean {
  return (
    hasTurnFactProgress(before, after) ||
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
  policyAccepted: boolean;
  appliedFacts: TurnPlanAuthorityFact[];
  assistantInteractionSource: 'turn_plan' | 'llm_text_fallback';
  /** Interaction que l'inférence texte aurait retenue, pour garder un shadow comparable. */
  legacyAssistantInteraction: PendingInteractionKind | 'none';
}

type AuthorityFactField = 'date' | 'time' | 'partySize';

/**
 * Un fait existant peut-il être remplacé par une correction du modèle ?
 * Jamais un fait validé par l'appelant ni un fait d'origine inconnue ; un fait
 * extrait explicitement seulement si le tour est interprété comme une correction.
 */
function isReplaceableFact(
  session: CallSession,
  field: AuthorityFactField,
  plan: TurnPlan,
): 'replaceable' | 'protected' {
  const current = session.conversation.slots[field];
  const provenance = session.conversation.slotProvenance?.[field];
  if (!provenance || provenance.value !== current) return 'protected';
  switch (provenance.source) {
    case 'contextual':
    case 'model':
      return 'replaceable';
    case 'explicit':
      return plan.interpretation === 'correction' ? 'replaceable' : 'protected';
    case 'confirmation':
      return 'protected';
  }
}

function writeModelFact(
  session: CallSession,
  field: AuthorityFactField,
  value: string | number,
): void {
  const { conversation } = session;
  if (field === 'partySize') conversation.slots.partySize = value as number;
  else conversation.slots[field] = value as string;
  conversation.slotProvenance = {
    ...conversation.slotProvenance,
    [field]: { source: 'model', value },
  };
}

/**
 * Faits du plan accepté par la policy. `set` ne remplit qu'un champ vide ;
 * `replace` ne corrige qu'un fait remplaçable ; un fait hésitant n'est jamais
 * enregistré ; `clear` n'est pas encore pris en charge.
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
  for (const fact of turnPlanFacts(plan)) {
    if (fact.field !== 'date' && fact.field !== 'time' && fact.field !== 'partySize') continue;
    const field = fact.field;
    if (fact.source === 'user_tentative') {
      recordVoiceTurnPlanAuthority(field, 'tentative');
      continue;
    }
    if (fact.op === 'clear' || fact.value === undefined) {
      recordVoiceTurnPlanAuthority(field, 'unsupported');
      continue;
    }
    // Un groupe au-delà du seuil n'est jamais écrit par le modèle : il passe
    // par la confirmation puis le gérant (parcours déterministe).
    if (field === 'partySize' && Number(fact.value) > voiceMaxPartySize(session)) {
      recordVoiceTurnPlanAuthority(field, 'unsupported');
      continue;
    }
    const current = conversation.slots[field];
    if (before.slots[field] === undefined && current === undefined) {
      writeModelFact(session, field, fact.value);
      applied.push(field);
      recordVoiceTurnPlanAuthority(field, 'applied');
      continue;
    }
    if (current === fact.value) {
      recordVoiceTurnPlanAuthority(field, 'already_set');
      continue;
    }
    if (fact.op !== 'replace') {
      recordVoiceTurnPlanAuthority(field, 'already_set');
      continue;
    }
    if (isReplaceableFact(session, field, plan) === 'protected') {
      recordVoiceTurnPlanAuthority(field, 'protected');
      continue;
    }
    writeModelFact(session, field, fact.value);
    applied.push(field);
    recordVoiceTurnPlanAuthority(field, 'replaced');
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
  const policyAccepted = decideTurnPlanPolicy(input.context, input.plan).status === 'accepted';
  const planProposal = policyAccepted
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
    policyAccepted,
    appliedFacts,
    assistantInteractionSource: planProposal ? 'turn_plan' : 'llm_text_fallback',
    legacyAssistantInteraction,
  };
}
