/**
 * Autorisation des actions que le tour structuré exécute côté serveur (réservation, message au
 * gérant, transfert) : une action à effet n'est jamais lancée sans l'accord explicite de l'appelant.
 *
 * Extrait tel quel de `turn-policy.ts` : aucun changement de comportement, seulement un autre fichier.
 */

import type { ConversationState, HumanFallbackMode, PendingInteractionKind } from './types';

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

export type VoiceToolAuthorizationBasis =
  | { kind: 'human_fallback_choice'; choice: 'transfer' | 'message' }
  | { kind: 'name_spelling_escalation' }
  | { kind: 'group_size'; choice: 'transfer' | 'message' };

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

export function normalizePolicyTranscript(value: string): string {
  return value
    .toLocaleLowerCase('fr-FR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[’']/gu, ' ')
    .replace(/[^\p{L}\p{N}:\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPolicyAffirmative(value: string): boolean {
  return /^(?:oui|ouais|ok(?:ay)?|d accord|dac|bien sur|exactement|tout a fait|ca marche|c est bon|c est bien ca|c est ca|ca me va|parfait|je confirme|yes|yeah|yep|sure|right|correct|alright)$/.test(
    normalizePolicyTranscript(value),
  );
}

export function explicitlyDeclinesAction(value: string, action: RegExp): boolean {
  const transcript = normalizePolicyTranscript(value);
  const hasNegation =
    /\b(?:je )?ne (?:veux|voudrais|souhaite|souhaiterais|peux|dois|vais) (?:pas|plus)\b/.test(
      transcript,
    ) || /\b(?:j ai )?pas envie de\b/.test(transcript);
  return hasNegation && action.test(transcript);
}

export function explicitlyRequestsTransfer(value: string): boolean {
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

export function explicitlyRequestsMessage(value: string): boolean {
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

export function explicitlyDeclinesCancellation(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  return (
    explicitlyDeclinesAction(value, /(?:annul\w*|supprim\w*|cancel\w*)/) ||
    /\b(?:ne|n) (?:me )?(?:annul\w*|supprim\w*|cancel\w*) pas\b/.test(transcript) ||
    /\bpas besoin\b.*\b(?:annul\w*|supprim\w*|cancel\w*)/.test(transcript)
  );
}

export function explicitlyRequestsCancellation(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (explicitlyDeclinesCancellation(value)) return false;
  return /\b(?:annul\w*|supprim\w*|cancel\w*)/.test(transcript);
}

export function explicitlyDeclinesDelay(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  return (
    explicitlyDeclinesAction(value, /(?:retard|late|delay)/) ||
    /\b(?:pas|aucun|aucune|sans|jamais)\b.{0,30}\b(?:retard|late|delay)\b/.test(transcript) ||
    /\b(?:ne|n) [\p{L}]+ pas\b.{0,40}\b(?:retard|late|delay)\b/u.test(transcript)
  );
}

export function explicitlyReportsDelay(value: string): boolean {
  const transcript = normalizePolicyTranscript(value);
  if (explicitlyDeclinesDelay(value)) return false;
  return /\b(?:retard|late|delay)\b/.test(transcript);
}

export function explicitlyRequestsGiftCardPurchase(value: string): boolean {
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

export function isPendingIntentFollowup(
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
      // Groupe au-delà du seuil, nombre confirmé : le transfert fait partie du parcours.
      const selectedByPolicy =
        (context.authorizationBasis?.kind === 'human_fallback_choice' ||
          context.authorizationBasis?.kind === 'group_size') &&
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
        (context.authorizationBasis?.kind === 'human_fallback_choice' ||
          context.authorizationBasis?.kind === 'group_size') &&
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
