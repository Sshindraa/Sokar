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
  parseStreamedDraft,
  outsideOpeningHoursFact,
  requestedSlotConflict,
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

describe('créneau demandé et disponibilités lues', () => {
  const day = {
    date: '2026-09-30',
    closed: false,
    slotsBySize: { 5: ['12:00', '18:30'], 2: [] as string[] },
  };
  const draft = (over: Partial<{ date: string; time: string; partySize: number }> = {}) => ({
    date: '2026-09-30',
    time: '15:30',
    partySize: 5,
    ...over,
  });

  it('signale un créneau absent des disponibilités du groupe, jamais quand on ne sait pas', () => {
    expect(requestedSlotConflict(day, draft())).toBe(true);
    expect(requestedSlotConflict(day, draft({ time: '18:30' }))).toBe(false);
    // Aucun créneau pour ce nombre : l'heure demandée n'y est pas non plus.
    expect(requestedSlotConflict(day, draft({ partySize: 2 }))).toBe(true);
    // Inconnu : jour non lu, autre jour, groupe hors lecture, brouillon incomplet.
    expect(requestedSlotConflict(null, draft())).toBe(false);
    expect(requestedSlotConflict(day, draft({ date: '2026-10-01' }))).toBe(false);
    expect(requestedSlotConflict(day, draft({ partySize: 9 }))).toBe(false);
    expect(requestedSlotConflict(day, draft({ time: '' }))).toBe(false);
    expect(requestedSlotConflict(day, draft({ partySize: 0 }))).toBe(false);
  });

  it('lit le brouillon dans un flux JSON partiel, avant la première phrase', () => {
    const streamed =
      '{"turnComplete":true,"interpretation":"answer","draft":{"date":"2026-09-30","time":"15:30","partySize":5,"customerName":""},"awaiting":"none"';
    expect(parseStreamedDraft(streamed)).toEqual({
      date: '2026-09-30',
      time: '15:30',
      partySize: 5,
    });
    // Tant que l'objet n'est pas fermé, rien n'est lisible.
    expect(parseStreamedDraft('{"turnComplete":true,"draft":{"date":"2026-09-30","ti')).toBeNull();
    expect(parseStreamedDraft('')).toBeNull();
  });
});

describe('outsideOpeningHoursFact', () => {
  const hours = {
    tue: { open: '12:00', close: '14:30' },
    sat: { open: '12:00', close: '23:00' },
    fri: { open: '18:00', close: '02:00' },
  };
  // 2026-10-06 est un mardi, 2026-10-10 un samedi, 2026-10-09 un vendredi, 2026-10-05 un lundi.
  it('donne le fait quand l’heure sort du service d’un jour ouvert', () => {
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-06', time: '20:00' })).toContain(
      'en dehors des horaires du mardi (12:00–14:30)',
    );
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-06', time: '11:00' })).not.toBeNull();
  });

  it('reste muet quand tout est compatible ou inconnu', () => {
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-06', time: '12:00' })).toBeNull();
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-06', time: '14:30' })).toBeNull();
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-10', time: '21:00' })).toBeNull();
    // Jour fermé : le calendrier donné au modèle le dit déjà.
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-05', time: '20:00' })).toBeNull();
    // Service de nuit (fermeture après minuit) : non tranché ici.
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-09', time: '23:30' })).toBeNull();
    expect(outsideOpeningHoursFact(null, { date: '2026-10-06', time: '20:00' })).toBeNull();
    expect(outsideOpeningHoursFact(hours, { date: '', time: '20:00' })).toBeNull();
    expect(outsideOpeningHoursFact(hours, { date: '2026-10-06', time: '' })).toBeNull();
  });
});
