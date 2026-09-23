import { describe, expect, it } from 'vitest';
import {
  authorizeVoiceTool,
  decideTurnPolicy,
  type DeterministicTurnProposal,
  type TurnPolicyContext,
  type VoiceToolPolicyContext,
} from '../stream/turn-policy';

function context(overrides: Partial<TurnPolicyContext> = {}): TurnPolicyContext {
  return {
    speechAct: 'content',
    intent: 'reservation',
    slots: {},
    customerName: undefined,
    activeInteractionKind: null,
    ...overrides,
  };
}

function proposal(overrides: Partial<DeterministicTurnProposal> = {}): DeterministicTurnProposal {
  return {
    intent: null,
    slots: {},
    partySizeEvidence: 'none',
    customerName: null,
    wantsAvailabilityOptions: false,
    ...overrides,
  };
}

describe('decideTurnPolicy', () => {
  it('rejects a contextual number when no party-size question is active', () => {
    const decision = decideTurnPolicy(
      context(),
      proposal({
        slots: { partySize: 4 },
        partySizeEvidence: 'contextual',
      }),
    );

    expect(decision.slots.partySize).toBeUndefined();
    expect(decision.resolveInteraction).toBeUndefined();
    expect(decision.progressed).toBe(false);
  });

  it('accepts a contextual number only for an active party-size interaction', () => {
    const decision = decideTurnPolicy(
      context({ activeInteractionKind: 'partySize' }),
      proposal({ slots: { partySize: 4 }, partySizeEvidence: 'contextual' }),
    );

    expect(decision.slots.partySize).toBe(4);
    expect(decision.resolveInteraction).toBe('partySize');
    expect(decision.progressed).toBe(true);
  });

  it('accepts an affirmative only for the exact pending party-size confirmation', () => {
    const proposalForFour = proposal({
      slots: { partySize: 4 },
      partySizeEvidence: 'confirmation',
    });
    const accepted = decideTurnPolicy(
      context({
        activeInteractionKind: 'partySizeConfirmation',
        activeInteractionCandidatePartySize: 4,
      }),
      proposalForFour,
    );
    const rejected = decideTurnPolicy(
      context({ activeInteractionKind: 'confirmation', activeInteractionCandidatePartySize: 4 }),
      proposalForFour,
    );

    expect(accepted.slots.partySize).toBe(4);
    expect(accepted.resolveInteraction).toBe('partySizeConfirmation');
    expect(rejected.slots.partySize).toBeUndefined();
    expect(rejected.resolveInteraction).toBeUndefined();
  });

  it('rejects out-of-range party sizes even when explicitly proposed', () => {
    const decision = decideTurnPolicy(
      context(),
      proposal({ slots: { partySize: 8 }, partySizeEvidence: 'explicit' }),
    );

    expect(decision.slots.partySize).toBeUndefined();
    expect(decision.progressed).toBe(false);
  });

  it('does not treat an accent-only name difference as a changed reservation fact', () => {
    const decision = decideTurnPolicy(
      context({ customerName: 'Élodie' }),
      proposal({ customerName: 'Elodie' }),
    );

    expect(decision.customerName).toBeUndefined();
    expect(decision.clearReservationConfirmation).toBe(false);
    expect(decision.progressed).toBe(false);
  });

  it('resolves a name interaction when the caller repeats the already-known name', () => {
    const decision = decideTurnPolicy(
      context({
        activeInteractionKind: 'customerName',
        customerName: 'Élodie',
      }),
      proposal({ customerName: 'Elodie' }),
    );

    expect(decision.customerName).toBeUndefined();
    expect(decision.resolveInteraction).toBe('customerName');
  });

  it('does not apply semantic proposals for liveness or backchannel turns', () => {
    const decision = decideTurnPolicy(
      context({ speechAct: 'backchannel' }),
      proposal({ intent: 'cancel', slots: { date: '2026-09-24' } }),
    );

    expect(decision.disposition).toBe('ignore');
    expect(decision.intent).toBeUndefined();
    expect(decision.slots).toEqual({});
  });

  it('marks a close as a non-mutating terminal decision for the caller to apply', () => {
    const decision = decideTurnPolicy(
      context({ speechAct: 'closing' }),
      proposal({ intent: 'cancel', slots: { date: '2026-09-24' } }),
    );

    expect(decision.disposition).toBe('close');
    expect(decision.clearReservationConfirmation).toBe(true);
    expect(decision.slots).toEqual({});
  });
});

function toolContext(overrides: Partial<VoiceToolPolicyContext> = {}): VoiceToolPolicyContext {
  return {
    toolName: 'handoffToManager',
    args: {},
    lastUserUtterance: '',
    intent: null,
    slots: {},
    lastAvailabilityResult: null,
    currentReservationKey: null,
    authorizedReservationKey: null,
    nameCollectionBlocked: false,
    managerConfigured: true,
    pendingInteraction: null,
    ...overrides,
  };
}

describe('authorizeVoiceTool', () => {
  it('requires the exact confirmed reservation draft and checked time', () => {
    const reservationContext = toolContext({
      toolName: 'createReservation',
      args: { date: '2026-09-25', time: '19:30', partySize: 4 },
      slots: { date: '2026-09-25', time: '19:30', partySize: 4 },
      lastAvailabilityResult: {
        key: '2026-09-25:19:30:4',
        date: '2026-09-25',
        time: '19:30',
        partySize: 4,
        slots: ['19:30'],
      },
      currentReservationKey: '2026-09-25:19:30:4:elodie-durand',
      authorizedReservationKey: '2026-09-25:19:30:4:elodie-durand',
    });

    expect(authorizeVoiceTool(reservationContext)).toEqual({ status: 'allowed' });
    expect(authorizeVoiceTool({ ...reservationContext, authorizedReservationKey: null })).toEqual({
      status: 'denied',
      reason: 'confirmation_required',
    });
    expect(
      authorizeVoiceTool({
        ...reservationContext,
        args: { ...reservationContext.args, time: '20:00' },
      }),
    ).toEqual({ status: 'denied', reason: 'confirmation_required' });
    expect(authorizeVoiceTool({ ...reservationContext, nameCollectionBlocked: true })).toEqual({
      status: 'denied',
      reason: 'name_confirmation_required',
    });
  });

  it('never treats an unqualified yes as a transfer choice', () => {
    const context = toolContext({ lastUserUtterance: 'Oui' });

    expect(authorizeVoiceTool(context)).toEqual({
      status: 'denied',
      reason: 'explicit_transfer_required',
    });
    expect(
      authorizeVoiceTool({
        ...context,
        pendingInteraction: { kind: 'humanFallback', fallbackMode: 'choice' },
      }),
    ).toEqual({ status: 'denied', reason: 'explicit_transfer_required' });
    expect(
      authorizeVoiceTool({
        ...context,
        lastUserUtterance: 'Je voudrais parler au gérant',
      }),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool({
        ...context,
        lastUserUtterance: 'Je ne veux pas parler au gérant',
      }),
    ).toEqual({ status: 'denied', reason: 'explicit_transfer_required' });
    expect(
      authorizeVoiceTool({ ...context, lastUserUtterance: 'Ne me transférez pas au gérant' }),
    ).toEqual({ status: 'denied', reason: 'explicit_transfer_required' });
    expect(
      authorizeVoiceTool({
        ...context,
        authorizationBasis: { kind: 'human_fallback_choice', choice: 'transfer' },
      }),
    ).toEqual({ status: 'allowed' });
    expect(authorizeVoiceTool({ ...context, managerConfigured: false })).toEqual({
      status: 'denied',
      reason: 'manager_unconfigured',
    });
  });

  it('requires an explicit message request or a typed fallback decision', () => {
    const context = toolContext({ toolName: 'takeMessage', lastUserUtterance: 'Oui' });

    expect(authorizeVoiceTool(context)).toEqual({
      status: 'denied',
      reason: 'explicit_message_required',
    });
    expect(
      authorizeVoiceTool({
        ...context,
        authorizationBasis: { kind: 'human_fallback_choice', choice: 'message' },
      }),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool({
        ...context,
        authorizationBasis: { kind: 'name_spelling_escalation' },
      }),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool({ ...context, lastUserUtterance: 'Je voudrais laisser un message' }),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool({ ...context, lastUserUtterance: 'Je ne veux pas laisser un message' }),
    ).toEqual({ status: 'denied', reason: 'explicit_message_required' });
  });

  it('does not authorize a stale or negated intent for a sensitive tool', () => {
    expect(authorizeVoiceTool(toolContext({ toolName: 'cancelReservation' }))).toEqual({
      status: 'denied',
      reason: 'intent_required',
    });
    expect(
      authorizeVoiceTool(
        toolContext({ toolName: 'cancelReservation', lastUserUtterance: 'Annuler ma réservation' }),
      ),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'cancelReservation',
          intent: 'cancel',
          lastUserUtterance: 'Oui',
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'intent_required' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'cancelReservation',
          intent: 'cancel',
          lastUserUtterance: 'Je ne veux pas annuler ma réservation',
          pendingInteraction: { kind: 'customerName', intentContext: 'cancel' },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'intent_required' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'cancelReservation',
          lastUserUtterance: "N'annulez pas ma réservation",
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'intent_required' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'cancelReservation',
          intent: 'cancel',
          lastUserUtterance: 'Jean Dupont',
          pendingInteraction: { kind: 'customerName', intentContext: 'cancel' },
        }),
      ),
    ).toEqual({ status: 'allowed' });

    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'reportDelay',
          lastUserUtterance: 'Nous aurons vingt minutes de retard',
        }),
      ),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool(
        toolContext({ toolName: 'reportDelay', intent: 'delay', lastUserUtterance: 'Oui' }),
      ),
    ).toEqual({ status: 'denied', reason: 'intent_required' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'reportDelay',
          intent: 'delay',
          lastUserUtterance: "Je n'ai pas de retard",
          pendingInteraction: { kind: 'time', intentContext: 'delay' },
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'intent_required' });

    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'purchaseGiftCard',
          lastUserUtterance: 'Je ne veux pas acheter de carte cadeau',
        }),
      ),
    ).toEqual({ status: 'denied', reason: 'intent_required' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'purchaseGiftCard',
          lastUserUtterance: 'Je voudrais acheter une carte cadeau de 50 euros',
        }),
      ),
    ).toEqual({ status: 'allowed' });
    expect(
      authorizeVoiceTool(
        toolContext({
          toolName: 'purchaseGiftCard',
          intent: 'gift_card',
          lastUserUtterance: 'Oui',
          pendingInteraction: { kind: 'confirmation', intentContext: 'gift_card' },
        }),
      ),
    ).toEqual({ status: 'allowed' });
  });
});
