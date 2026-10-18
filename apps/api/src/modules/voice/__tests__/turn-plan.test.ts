import { describe, expect, it } from 'vitest';
import { parseTurnPlan } from '../stream/turn-plan';
import { decideTurnPlanPolicy } from '../stream/turn-policy';

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
      facts: [{ field: 'partySize', op: 'set', value: 4, source: 'user_explicit' }],
      slots: { partySize: 4 },
      interactionDisposition: 'resolve',
      confidence: 'high',
    });
  });

  it('lit les patches avec opération et origine, sans compter un fait hésitant', () => {
    const plan = parseTurnPlan(
      JSON.stringify({
        interpretation: 'correction',
        intent: 'unchanged',
        facts: [
          { field: 'partySize', op: 'replace', value: 5, source: 'correction' },
          { field: 'time', op: 'set', value: '20:00', source: 'user_tentative' },
          { field: 'date', op: 'clear', source: 'user_explicit' },
        ],
        interactionDisposition: 'none',
        confidence: 'high',
      }),
    );
    expect(plan?.facts).toHaveLength(3);
    expect(plan?.slots).toEqual({ partySize: 5 });
  });

  it('refuse aussi via les facts un plan unclear ou touchant au téléphone', () => {
    const context = {
      transcript: 'euh peut-être',
      language: 'fr',
      timezone: 'Europe/Paris',
      referenceTime: '2026-09-23T10:00:00.000Z',
      intent: null,
      pendingInteraction: null,
      slots: {},
      hasConfirmedName: false,
    };
    const base = {
      intent: 'unchanged' as const,
      slots: {},
      interactionDisposition: 'none' as const,
      confidence: 'high' as const,
    };
    expect(
      decideTurnPlanPolicy(context, {
        ...base,
        interpretation: 'unclear',
        facts: [{ field: 'partySize', op: 'set', value: 5, source: 'user_tentative' }],
      }),
    ).toMatchObject({ status: 'rejected', reason: 'unclear_with_facts' });
    expect(
      decideTurnPlanPolicy(context, {
        ...base,
        interpretation: 'answer',
        facts: [{ field: 'customerPhone', op: 'clear', source: 'correction' }],
      }),
    ).toMatchObject({ status: 'rejected', reason: 'unsupported_phone_slot' });
  });

  it.each([
    ['slots et facts ensemble', { slots: {}, facts: [] }],
    [
      'un champ en double',
      {
        facts: [
          { field: 'partySize', op: 'set', value: 4, source: 'user_explicit' },
          { field: 'partySize', op: 'replace', value: 5, source: 'correction' },
        ],
      },
    ],
    [
      'clear avec valeur',
      { facts: [{ field: 'date', op: 'clear', value: '2026-09-25', source: 'correction' }] },
    ],
    ['set sans valeur', { facts: [{ field: 'date', op: 'set', source: 'user_explicit' }] }],
    ['origine inconnue', { facts: [{ field: 'partySize', op: 'set', value: 4, source: 'guess' }] }],
    [
      'clé inattendue',
      { facts: [{ field: 'partySize', op: 'set', value: 4, source: 'user_explicit', note: 'x' }] },
    ],
    ['aucun fait ni slot', {}],
  ])('refuse un plan avec %s', (_label, factsOrSlots) => {
    expect(
      parseTurnPlan(
        JSON.stringify({
          interpretation: 'answer',
          intent: 'unchanged',
          interactionDisposition: 'none',
          confidence: 'high',
          ...factsOrSlots,
        }),
      ),
    ).toBeNull();
  });

  it.each([
    { partySize: 101 },
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
