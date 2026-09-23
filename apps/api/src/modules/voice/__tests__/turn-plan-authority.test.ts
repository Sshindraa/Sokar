import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTurnPlanAuthority, isTurnPlanAuthorityEnabled } from '../stream/turn-plan-authority';
import { captureTurnPlanPolicySnapshot } from '../stream/turn-plan-shadow';
import {
  activatePendingInteraction,
  createConversationState,
  getActivePendingInteraction,
  recordUserTurn,
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
  it('reste coupé sans le shadow ni restaurant explicitement autorisé', () => {
    const enabled = {
      VOICE_TURN_PLAN_AUTHORITY_ENABLED: 'true',
      VOICE_TURN_PLAN_SHADOW_ENABLED: 'true',
    };
    expect(isTurnPlanAuthorityEnabled('pilot-1', {})).toBe(false);
    expect(
      isTurnPlanAuthorityEnabled('pilot-1', {
        VOICE_TURN_PLAN_AUTHORITY_ENABLED: 'true',
        VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS: 'pilot-1',
      } as NodeJS.ProcessEnv),
    ).toBe(false);
    expect(isTurnPlanAuthorityEnabled('pilot-1', enabled as NodeJS.ProcessEnv)).toBe(false);
    const pilot = {
      ...enabled,
      VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS: ' pilot-1 , pilot-2 ',
    } as NodeJS.ProcessEnv;
    expect(isTurnPlanAuthorityEnabled('pilot-2', pilot)).toBe(true);
    expect(isTurnPlanAuthorityEnabled('other', pilot)).toBe(false);
    expect(isTurnPlanAuthorityEnabled(undefined, pilot)).toBe(false);
    expect(
      isTurnPlanAuthorityEnabled('other', {
        ...enabled,
        VOICE_TURN_PLAN_AUTHORITY_RESTAURANT_IDS: '*',
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

describe('TurnPlan canary authority — opération et provenance', () => {
  function sessionWithPartySize(
    source: 'explicit' | 'contextual' | 'confirmation' | 'model' | null,
    value = 1,
  ): CallSession {
    const session = makeSession();
    session.conversation.intent = 'reservation';
    session.conversation.slots.partySize = value;
    if (source) session.conversation.slotProvenance = { partySize: { source, value } };
    return session;
  }

  function replacePartySize(
    session: CallSession,
    overrides: Partial<TurnPlan> = {},
    source: 'correction' | 'user_explicit' | 'user_tentative' = 'correction',
  ) {
    return applyTurnPlanAuthority(session, {
      context: contextFor(session, 'on sera cinq en fait'),
      plan: plan({
        interpretation: 'correction',
        facts: [{ field: 'partySize', op: 'replace', value: 5, source }],
        slots: source === 'user_tentative' ? {} : { partySize: 5 },
        ...overrides,
      }),
      before: captureTurnPlanPolicySnapshot(session, null),
      speechAct: 'content',
      reply: 'Entendu, pour cinq. Pour quel jour ?',
    });
  }

  it('remplace un nombre lu par la regex contextuelle', async () => {
    const session = sessionWithPartySize('contextual');

    const result = replacePartySize(session, { interpretation: 'answer' }, 'user_explicit');

    expect(result.appliedFacts).toEqual(['partySize']);
    expect(session.conversation.slots.partySize).toBe(5);
    expect(session.conversation.slotProvenance?.partySize).toEqual({ source: 'model', value: 5 });
    expect(await renderMetrics()).toMatch(
      /sokar_voice_turn_plan_authority_total\{field="partySize",outcome="replaced"\} 1/,
    );
  });

  it('ne remplace un fait explicite que si le tour est une correction', () => {
    const answer = sessionWithPartySize('explicit', 4);
    replacePartySize(answer, { interpretation: 'answer' });
    expect(answer.conversation.slots.partySize).toBe(4);

    const correction = sessionWithPartySize('explicit', 4);
    replacePartySize(correction);
    expect(correction.conversation.slots.partySize).toBe(5);
  });

  it('protège un fait validé par l’appelant et un fait d’origine inconnue ou périmée', async () => {
    const confirmed = sessionWithPartySize('confirmation', 4);
    replacePartySize(confirmed);
    expect(confirmed.conversation.slots.partySize).toBe(4);

    const unknown = sessionWithPartySize(null, 4);
    replacePartySize(unknown);
    expect(unknown.conversation.slots.partySize).toBe(4);

    const stale = sessionWithPartySize('contextual', 4);
    stale.conversation.slotProvenance = { partySize: { source: 'contextual', value: 2 } };
    replacePartySize(stale);
    expect(stale.conversation.slots.partySize).toBe(4);

    expect(await renderMetrics()).toMatch(
      /sokar_voice_turn_plan_authority_total\{field="partySize",outcome="protected"\} 3/,
    );
  });

  it('n’enregistre jamais un fait hésitant, même dans un champ vide', async () => {
    const session = makeSession();
    session.conversation.intent = 'reservation';

    const result = applyTurnPlanAuthority(session, {
      context: contextFor(session, 'peut-être cinq, je dois vérifier'),
      plan: plan({
        facts: [{ field: 'partySize', op: 'set', value: 5, source: 'user_tentative' }],
      }),
      before: captureTurnPlanPolicySnapshot(session, null),
      speechAct: 'content',
      reply: 'Pas de souci. Vous me direz quand vous saurez ?',
    });

    expect(result.appliedFacts).toEqual([]);
    expect(session.conversation.slots.partySize).toBeUndefined();
    expect(await renderMetrics()).toMatch(
      /sokar_voice_turn_plan_authority_total\{field="partySize",outcome="tentative"\} 1/,
    );
  });

  it('ne prend pas encore en charge le retrait d’un fait', () => {
    const session = sessionWithPartySize('contextual', 4);

    applyTurnPlanAuthority(session, {
      context: contextFor(session, 'oubliez le nombre'),
      plan: plan({ facts: [{ field: 'partySize', op: 'clear', source: 'correction' }] }),
      before: captureTurnPlanPolicySnapshot(session, null),
      speechAct: 'content',
      reply: 'D’accord. Vous serez combien ?',
    });

    expect(session.conversation.slots.partySize).toBe(4);
  });

  it('invalide l’accord de réservation après un remplacement', () => {
    const session = sessionWithPartySize('contextual', 4);
    session.conversation.pendingReservationConfirmationKey = 'k';
    session.conversation.confirmedReservationKey = 'k';

    replacePartySize(session);

    expect(session.conversation.pendingReservationConfirmationKey).toBeNull();
    expect(session.conversation.confirmedReservationKey).toBeNull();
  });

  it('enregistre la provenance posée par les extracteurs', () => {
    const session = makeSession();
    activatePendingInteraction(session, 'partySize', 'Vous serez combien ?');

    recordUserTurn(session, 'quatre', 'content', new Date('2026-09-22T10:00:00Z'));
    expect(session.conversation.slotProvenance?.partySize).toEqual({
      source: 'contextual',
      value: 4,
    });

    recordUserTurn(session, 'demain pour 6 personnes', 'content', new Date('2026-09-22T10:00:00Z'));
    expect(session.conversation.slotProvenance?.partySize).toEqual({
      source: 'explicit',
      value: 6,
    });
    expect(session.conversation.slotProvenance?.date?.source).toBe('explicit');
  });
});
