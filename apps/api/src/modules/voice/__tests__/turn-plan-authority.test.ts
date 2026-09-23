import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTurnPlanAuthority, isTurnPlanAuthorityEnabled } from '../stream/turn-plan-authority';
import { captureTurnPlanPolicySnapshot } from '../stream/turn-plan-shadow';
import {
  activatePendingInteraction,
  createConversationState,
  getActivePendingInteraction,
} from '../stream/conversation-controller';
import type { TurnPlan, TurnPlanContext } from '../stream/turn-plan';
import type { CallSession } from '../stream/types';
import { __resetMetrics, renderMetrics } from '../../../shared/observability/metrics';

beforeEach(() => __resetMetrics());
afterEach(() => vi.unstubAllEnvs());

function makeSession(): CallSession {
  return {
    callControlId: 'test-call',
    restaurantId: 'test-restaurant',
    timezone: 'Europe/Paris',
    conversation: createConversationState(),
  } as unknown as CallSession;
}

function contextFor(session: CallSession, transcript: string): TurnPlanContext {
  const active = getActivePendingInteraction(session);
  return {
    transcript,
    language: 'fr',
    timezone: 'Europe/Paris',
    referenceTime: '2026-09-23T10:00:00.000Z',
    intent: session.conversation.intent,
    pendingInteraction: active
      ? {
          kind: active.kind,
          intentContext: active.intentContext ?? null,
          ...(active.candidatePartySize !== undefined
            ? { candidatePartySize: active.candidatePartySize }
            : {}),
        }
      : null,
    slots: {},
    hasConfirmedName: false,
  };
}

function plan(overrides: Partial<TurnPlan>): TurnPlan {
  return {
    interpretation: 'answer',
    intent: 'unchanged',
    slots: {},
    interactionDisposition: 'none',
    confidence: 'high',
    assistantInteraction: 'none',
    ...overrides,
  };
}

describe('TurnPlan canary authority', () => {
  it('reste coupé sans le shadow, même si le flag d’autorité est posé', () => {
    expect(isTurnPlanAuthorityEnabled({})).toBe(false);
    expect(
      isTurnPlanAuthorityEnabled({
        VOICE_TURN_PLAN_AUTHORITY_ENABLED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(
      isTurnPlanAuthorityEnabled({
        VOICE_TURN_PLAN_AUTHORITY_ENABLED: 'true',
        VOICE_TURN_PLAN_SHADOW_ENABLED: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it('complète un fait que le déterministe a manqué et fixe l’interaction suivante', async () => {
    const session = makeSession();
    session.conversation.intent = 'reservation';
    activatePendingInteraction(session, 'partySize', 'Vous serez combien ?');
    const transcript = 'on sera une petite tablée de cinq';
    const context = contextFor(session, transcript);
    const before = captureTurnPlanPolicySnapshot(session, null);

    const result = applyTurnPlanAuthority(session, {
      context,
      plan: plan({
        slots: { partySize: 5 },
        interactionDisposition: 'resolve',
        assistantInteraction: 'time',
      }),
      before,
      speechAct: 'content',
      reply: 'Très bien, pour cinq. Vers quelle heure souhaitez-vous venir ?',
    });

    expect(result.appliedFacts).toEqual(['partySize']);
    expect(result.assistantInteractionSource).toBe('turn_plan');
    expect(session.conversation.slots.partySize).toBe(5);
    expect(session.conversation.pendingQuestion).toBe('time');
    expect(getActivePendingInteraction(session)?.prompt).toBe(
      'Vers quelle heure souhaitez-vous venir ?',
    );
    const payload = await renderMetrics();
    expect(payload).toMatch(
      /sokar_voice_turn_plan_authority_total\{field="partySize",outcome="applied"\} 1/,
    );
    expect(payload).toMatch(
      /sokar_voice_turn_plan_authority_total\{field="assistant_interaction",outcome="applied"\} 1/,
    );
  });

  it('ne remplace jamais un fait déjà connu ou posé par le déterministe', () => {
    const session = makeSession();
    session.conversation.intent = 'reservation';
    session.conversation.slots.partySize = 4;
    const before = captureTurnPlanPolicySnapshot(session, null);

    const result = applyTurnPlanAuthority(session, {
      context: contextFor(session, 'plutôt six en fait'),
      plan: plan({ interpretation: 'correction', slots: { partySize: 6 } }),
      before,
      speechAct: 'correction',
      reply: 'Entendu.',
    });

    expect(result.appliedFacts).toEqual([]);
    expect(session.conversation.slots.partySize).toBe(4);
  });

  it('ignore les faits d’un plan refusé par la policy', () => {
    const session = makeSession();
    const before = captureTurnPlanPolicySnapshot(session, null);

    const result = applyTurnPlanAuthority(session, {
      context: contextFor(session, 'peut-être cinq, je dois vérifier'),
      plan: plan({ slots: { partySize: 5 }, confidence: 'medium', intent: 'reservation' }),
      before,
      speechAct: 'content',
      reply: 'Pas de souci. Pour quel jour ?',
    });

    expect(result.appliedFacts).toEqual([]);
    expect(session.conversation.slots.partySize).toBeUndefined();
    expect(session.conversation.intent).toBeNull();
    expect(result.assistantInteractionSource).toBe('llm_text_fallback');
    expect(session.conversation.pendingQuestion).toBe('date');
  });

  it('ne fait pas porter un récapitulatif de confirmation par le plan', () => {
    const session = makeSession();
    session.conversation.intent = 'reservation';
    Object.assign(session.conversation.slots, {
      date: '2026-09-25',
      time: '20:00',
      partySize: 4,
      customerName: 'Martin',
    });
    const before = captureTurnPlanPolicySnapshot(session, null);

    const result = applyTurnPlanAuthority(session, {
      context: contextFor(session, 'Martin'),
      plan: plan({ assistantInteraction: 'open' }),
      before,
      speechAct: 'content',
      reply: 'Vendredi 25 à 20 h pour 4 au nom de Martin, vous me confirmez ?',
    });

    expect(result.assistantInteractionSource).toBe('llm_text_fallback');
    expect(result.legacyAssistantInteraction).toBe('confirmation');
    expect(session.conversation.pendingQuestion).toBe('confirmation');
  });

  it('refuse un plan « none » quand la réponse se termine par une question', () => {
    const session = makeSession();
    const before = captureTurnPlanPolicySnapshot(session, null);

    const result = applyTurnPlanAuthority(session, {
      context: contextFor(session, 'bonjour'),
      plan: plan({ assistantInteraction: 'none' }),
      before,
      speechAct: 'content',
      reply: 'Bonjour ! Pour quel jour souhaitez-vous réserver ?',
    });

    expect(result.assistantInteractionSource).toBe('llm_text_fallback');
    expect(session.conversation.pendingQuestion).toBe('date');
  });

  it('n’applique aucun fait sur un acquiescement ou une relance', () => {
    const session = makeSession();
    const before = captureTurnPlanPolicySnapshot(session, null);

    const result = applyTurnPlanAuthority(session, {
      context: contextFor(session, 'euh'),
      plan: plan({ slots: { date: '2026-09-25' } }),
      before,
      speechAct: 'backchannel',
      reply: 'Je vous écoute.',
    });

    expect(result.appliedFacts).toEqual([]);
    expect(session.conversation.slots.date).toBeUndefined();
  });
});
