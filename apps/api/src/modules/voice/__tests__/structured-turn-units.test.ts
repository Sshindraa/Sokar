import { describe, expect, it } from 'vitest';
import { PhraseSplitter, SayStreamExtractor } from '../stream/structured-turn/say-stream';
import {
  parseStructuredTurnOutput,
  type StructuredTurnOutput,
} from '../stream/structured-turn/schema';
import {
  applyProposedDraft,
  authorizeStructuredAction,
  bookingKey,
  createStructuredTurnState,
  todayInTimezone,
} from '../stream/structured-turn/fact-guards';

function output(overrides: Partial<StructuredTurnOutput> = {}): StructuredTurnOutput {
  return {
    turnComplete: true,
    interpretation: 'answer',
    draft: { date: '', time: '', partySize: 0, customerName: '' },
    awaiting: 'none',
    action: 'none',
    message: '',
    confidence: 'high',
    say: 'Bien sûr.',
    ...overrides,
  };
}

describe('SayStreamExtractor', () => {
  it('décode la phrase au fil des fragments, échappements compris', () => {
    const json = JSON.stringify({
      interpretation: 'question',
      action: 'none',
      say: 'Nous ouvrons à 19 h. C’est "parfait" ?\nVous voulez réserver ?',
    });
    const extractor = new SayStreamExtractor();
    let said = '';
    for (let index = 0; index < json.length; index += 3) {
      said += extractor.push(json.slice(index, index + 3));
    }
    expect(said).toBe('Nous ouvrons à 19 h. C’est "parfait" ? Vous voulez réserver ?');
  });

  it('ne renvoie rien avant l’ouverture de say', () => {
    const extractor = new SayStreamExtractor();
    expect(extractor.push('{"interpretation":"answer","action":"none",')).toBe('');
    expect(extractor.push('"say":"Bon')).toBe('Bon');
    expect(extractor.push('jour."}')).toBe('jour.');
  });
});

describe('PhraseSplitter', () => {
  it('rend les phrases complètes et garde la fin', () => {
    const splitter = new PhraseSplitter();
    expect(splitter.push('Parfait. Pour combien')).toEqual(['Parfait.']);
    expect(splitter.push(' de personnes ? Merci')).toEqual(['Pour combien de personnes ?']);
    expect(splitter.flush()).toBe('Merci');
  });
});

describe('parseStructuredTurnOutput', () => {
  it('accepte une sortie conforme et refuse une forme invalide', () => {
    expect(parseStructuredTurnOutput(JSON.stringify(output()))).toEqual(output());
    expect(parseStructuredTurnOutput('{"say":"x"}')).toBeNull();
    expect(parseStructuredTurnOutput('pas du json')).toBeNull();
  });
});

describe('applyProposedDraft', () => {
  const today = '2026-09-26';

  it('garde la valeur précédente quand la proposition est invalide', () => {
    const previous = { date: '2026-09-27', time: '20:00', partySize: 4, customerName: '' };
    const result = applyProposedDraft(
      previous,
      output({ draft: { date: '2026-09-20', time: '25:00', partySize: 4, customerName: 'A2KIF' } }),
      { today },
    );
    expect(result.draft).toEqual(previous);
    expect(result.rejected.sort()).toEqual(['customerName', 'date', 'time']);
  });

  it('n’efface une valeur que sur une correction', () => {
    const previous = { date: '2026-09-27', time: '20:00', partySize: 4, customerName: '' };
    const blank = { date: '', time: '', partySize: 0, customerName: '' };
    expect(applyProposedDraft(previous, output({ draft: blank }), { today }).draft).toEqual(
      previous,
    );
    expect(
      applyProposedDraft(previous, output({ draft: blank, interpretation: 'correction' }), {
        today,
      }).draft,
    ).toEqual(blank);
  });
});

describe('authorizeStructuredAction', () => {
  const draft = { date: '2026-09-27', time: '20:00', partySize: 4, customerName: 'Akkif' };
  const verifiedState = () => ({
    ...createStructuredTurnState(),
    draft,
    availability: { date: draft.date, partySize: 4, slots: ['19:30', '20:00'] },
  });

  it('refuse la création sans récapitulatif lu au tour précédent', () => {
    const decision = authorizeStructuredAction(
      verifiedState(),
      output({ action: 'create_reservation', interpretation: 'affirmation' }),
      draft,
      { maxPartySize: 7 },
    );
    expect(decision).toEqual({ allowed: false, reason: 'recap_not_read' });
  });

  it('autorise la création après un récapitulatif accepté sur un créneau vérifié', () => {
    const state = { ...verifiedState(), lastAwaiting: 'confirmation' as const };
    state.recapKey = bookingKey(draft);
    expect(
      authorizeStructuredAction(
        state,
        output({ action: 'create_reservation', interpretation: 'affirmation' }),
        draft,
        { maxPartySize: 7 },
      ),
    ).toEqual({ allowed: true });
  });

  it('refuse un récapitulatif différent du brouillon ou un créneau non vérifié', () => {
    const state = { ...verifiedState(), lastAwaiting: 'confirmation' as const };
    state.recapKey = bookingKey({ ...draft, time: '19:30' });
    expect(
      authorizeStructuredAction(
        state,
        output({ action: 'create_reservation', interpretation: 'affirmation' }),
        draft,
        { maxPartySize: 7 },
      ),
    ).toEqual({ allowed: false, reason: 'recap_not_read' });
    const unverified = { ...state, recapKey: bookingKey(draft), availability: null };
    expect(
      authorizeStructuredAction(
        unverified,
        output({ action: 'create_reservation', interpretation: 'affirmation' }),
        draft,
        { maxPartySize: 7 },
      ),
    ).toEqual({ allowed: false, reason: 'slot_not_verified' });
  });

  it('refuse toute action à effet sur un plan peu sûr', () => {
    expect(
      authorizeStructuredAction(
        verifiedState(),
        output({ action: 'end_call', confidence: 'low' }),
        draft,
        { maxPartySize: 7 },
      ),
    ).toEqual({ allowed: false, reason: 'low_confidence' });
  });
});

describe('todayInTimezone', () => {
  it('suit le fuseau du restaurant', () => {
    expect(todayInTimezone('Europe/Paris', new Date('2026-09-25T23:30:00Z'))).toBe('2026-09-26');
  });
});
