import { describe, expect, it } from 'vitest';
import { parseTurnPlan } from '../stream/turn-plan';
import {
  captureTurnPlanPolicySnapshot,
  compareTurnPlanWithPolicy,
  isTurnPlanShadowEnabled,
} from '../stream/turn-plan-shadow';
import { decideTurnPlanPolicy } from '../stream/turn-policy';
import { createConversationState } from '../stream/conversation-controller';
import type { CallSession } from '../stream/types';

describe('parseTurnPlan', () => {
  it('valide une proposition structurée sans lui donner d’autorité', () => {
    expect(
      parseTurnPlan(
        JSON.stringify({
          interpretation: 'answer',
          intent: 'unchanged',
          slots: { partySize: 4 },
          interactionDisposition: 'resolve',
          confidence: 'high',
        }),
      ),
    ).toEqual({
      interpretation: 'answer',
      intent: 'unchanged',
      slots: { partySize: 4 },
      interactionDisposition: 'resolve',
      confidence: 'high',
    });
  });

  it.each([
    { partySize: 8 },
    { date: '2026-02-30' },
    { time: '24:00' },
    { createReservation: true },
  ])('rejette une valeur hors contrat: %j', (slots) => {
    expect(
      parseTurnPlan(
        JSON.stringify({
          interpretation: 'answer',
          intent: 'unchanged',
          slots,
          interactionDisposition: 'keep',
          confidence: 'medium',
        }),
      ),
    ).toBeNull();
  });

  it('rejette un texte qui ne respecte pas le format JSON attendu', () => {
    expect(parseTurnPlan('Je pense que la réponse est quatre.')).toBeNull();
  });

  it('exige un type d’interaction explicite pour le shadow intégré au flux parlé', () => {
    const base = {
      interpretation: 'answer',
      intent: 'unchanged',
      slots: {},
      interactionDisposition: 'keep',
      confidence: 'medium',
    };
    expect(parseTurnPlan(JSON.stringify(base), { requireAssistantInteraction: true })).toBeNull();
    expect(
      parseTurnPlan(JSON.stringify({ ...base, assistantInteraction: 'partySize' }), {
        requireAssistantInteraction: true,
      }),
    ).toMatchObject({ assistantInteraction: 'partySize' });
    expect(
      parseTurnPlan(JSON.stringify({ ...base, assistantInteraction: 'createReservation' }), {
        requireAssistantInteraction: true,
      }),
    ).toBeNull();
  });
});

describe('TurnPlan shadow policy boundary', () => {
  it('applique le flag global à tous les restaurants sans allowlist', () => {
    expect(isTurnPlanShadowEnabled({})).toBe(false);
    expect(
      isTurnPlanShadowEnabled({
        VOICE_TURN_PLAN_SHADOW_ENABLED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(
      isTurnPlanShadowEnabled({
        VOICE_TURN_PLAN_SHADOW_ENABLED: 'false',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it('compare la proposition aux seules valeurs effectivement appliquées', () => {
    const session = {
      restaurantId: 'pilot-1',
      conversation: createConversationState(),
    } as CallSession;
    const before = captureTurnPlanPolicySnapshot(session, null);
    session.conversation.intent = 'reservation';
    session.conversation.slots.partySize = 4;
    const after = captureTurnPlanPolicySnapshot(session, null);

    expect(
      compareTurnPlanWithPolicy(
        {
          interpretation: 'answer',
          intent: 'reservation',
          slots: { partySize: 4 },
          interactionDisposition: 'none',
          confidence: 'high',
        },
        before,
        after,
      ),
    ).toMatchObject({
      agrees: true,
      slotAgreement: true,
      intentAgreement: true,
      interactionAgreement: true,
      proposedSlotCount: 1,
      actualSlotCount: 1,
    });
  });

  it('signale une contradiction sans appliquer la valeur proposée', () => {
    const session = {
      restaurantId: 'pilot-1',
      conversation: createConversationState(),
    } as CallSession;
    const before = captureTurnPlanPolicySnapshot(session, null);
    session.conversation.slots.partySize = 4;
    const after = captureTurnPlanPolicySnapshot(session, null);
    const plan = {
      interpretation: 'answer' as const,
      intent: 'unchanged' as const,
      slots: { partySize: 3 },
      interactionDisposition: 'none' as const,
      confidence: 'high' as const,
    };

    expect(compareTurnPlanWithPolicy(plan, before, after)).toMatchObject({
      agrees: false,
      slotAgreement: false,
      intentAgreement: true,
      interactionAgreement: true,
    });
    expect(session.conversation.slots.partySize).toBe(4);
  });

  it('compare le type de question proposé au type réellement ouvert par la réponse', () => {
    const session = {
      restaurantId: 'pilot-1',
      conversation: createConversationState(),
    } as CallSession;
    session.conversation.intent = 'reservation';
    const before = captureTurnPlanPolicySnapshot(session, null);
    session.conversation.pendingInteractions.push({
      id: 1,
      kind: 'partySize',
      prompt: 'Pour combien de personnes ?',
      status: 'active',
      resumePolicy: null,
    });
    const after = captureTurnPlanPolicySnapshot(session, null);
    const plan = {
      interpretation: 'new_request' as const,
      intent: 'reservation' as const,
      slots: {},
      interactionDisposition: 'none' as const,
      confidence: 'high' as const,
      assistantInteraction: 'partySize' as const,
    };

    expect(compareTurnPlanWithPolicy(plan, before, after)).toMatchObject({
      agrees: true,
      assistantInteractionAgreement: true,
    });
    expect(
      compareTurnPlanWithPolicy({ ...plan, assistantInteraction: 'time' }, before, after),
    ).toMatchObject({ agrees: false, assistantInteractionAgreement: false });
  });

  it('accepte un patch de faits mais n’autorise jamais un outil', () => {
    const context = Object.freeze({
      transcript: 'quatre',
      language: 'fr',
      timezone: 'Europe/Paris',
      referenceTime: '2026-09-23T10:00:00.000Z',
      intent: 'reservation' as const,
      pendingInteraction: Object.freeze({ kind: 'partySize' as const }),
      slots: Object.freeze({}),
      hasConfirmedName: false,
    });
    const plan = Object.freeze({
      interpretation: 'answer' as const,
      intent: 'unchanged' as const,
      slots: Object.freeze({ partySize: 4 }),
      interactionDisposition: 'resolve' as const,
      confidence: 'high' as const,
    });

    expect(decideTurnPlanPolicy(context, plan)).toEqual({
      status: 'accepted',
      intentPatch: null,
      factPatch: { partySize: 4 },
      interactionDisposition: 'resolve',
      allowedTools: [],
    });
    expect(context.slots).toEqual({});
  });

  it.each([
    {
      pendingInteraction: null,
      plan: {
        interpretation: 'answer',
        intent: 'unchanged',
        slots: {},
        interactionDisposition: 'resolve',
        confidence: 'high',
      },
      reason: 'pending_interaction_mismatch',
    },
    {
      pendingInteraction: { kind: 'humanFallback', fallbackMode: 'choice' },
      plan: {
        interpretation: 'affirmation',
        intent: 'unchanged',
        slots: {},
        interactionDisposition: 'resolve',
        confidence: 'high',
      },
      reason: 'unsafe_affirmation',
    },
    {
      pendingInteraction: { kind: 'partySizeConfirmation', candidatePartySize: 4 },
      plan: {
        interpretation: 'affirmation',
        intent: 'unchanged',
        slots: { partySize: 5 },
        interactionDisposition: 'resolve',
        confidence: 'high',
      },
      reason: 'unsafe_affirmation',
    },
  ] as const)(
    'rejette un plan contradictoire sans modifier le contexte: $reason',
    ({ pendingInteraction, plan, reason }) => {
      const context = {
        transcript: 'oui',
        language: 'fr',
        timezone: 'Europe/Paris',
        referenceTime: '2026-09-23T10:00:00.000Z',
        intent: 'reservation' as const,
        pendingInteraction,
        slots: { partySize: 4 },
        hasConfirmedName: false,
      };

      expect(decideTurnPlanPolicy(context, plan)).toMatchObject({ status: 'rejected', reason });
      expect(context.slots.partySize).toBe(4);
    },
  );
});
