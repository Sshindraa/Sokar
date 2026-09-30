import { describe, expect, it } from 'vitest';
import { PhraseSplitter, SayStreamExtractor } from '../stream/structured-turn/say-stream';
import {
  buildStructuredTurnJsonSchema,
  parseStructuredTurnOutput,
  type StructuredTurnOutput,
} from '../stream/structured-turn/schema';
import { buildStructuredTurnMessages } from '../stream/structured-turn/prompt';
import { isVoiceUnderstandingCheckEnabled } from '../stream/feature-flags';
import {
  applyProposedDraft,
  authorizeStructuredAction,
  bookingKey,
  createStructuredTurnState,
  parseStreamedDraft,
  outsideOpeningHoursFact,
  reconcileSpelledName,
  requestedSlotConflict,
  spelledLettersOf,
  spelledNameFact,
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

describe('vérification de compréhension', () => {
  const today = '2026-09-26';
  const previous = { date: '', time: '', partySize: 0, customerName: '' };
  const proposed = { date: '2026-09-27', time: '20:00', partySize: 0, customerName: '' };

  it('schéma : reading et understanding viennent avant le brouillon, seulement avec le drapeau', () => {
    const on = buildStructuredTurnJsonSchema(undefined, { understanding: true });
    const keys = Object.keys(on.properties);
    expect(keys.indexOf('reading')).toBeGreaterThan(keys.indexOf('turnComplete'));
    expect(keys.indexOf('understanding')).toBeLessThan(keys.indexOf('draft'));
    expect(on.required).toEqual(expect.arrayContaining(['reading', 'understanding']));
    const off = buildStructuredTurnJsonSchema();
    expect(Object.keys(off.properties)).not.toContain('reading');
    expect(off.required).not.toContain('understanding');
  });

  it("parse : garde reading et understanding quand ils sont là, et n'en ajoute pas sinon", () => {
    const withReading = output({ reading: 'lecture', understanding: 'doubtful' });
    expect(parseStructuredTurnOutput(JSON.stringify(withReading))).toEqual(withReading);
    expect(parseStructuredTurnOutput(JSON.stringify(output()))).not.toHaveProperty('understanding');
    const bad = { ...withReading, understanding: 'peut-être' };
    expect(parseStructuredTurnOutput(JSON.stringify(bad))).not.toHaveProperty('understanding');
  });

  it("doubtful : aucune valeur n'entre dans le brouillon, elles sont listées comme rejetées", () => {
    const result = applyProposedDraft(
      previous,
      output({ draft: proposed, understanding: 'doubtful', interpretation: 'unclear' }),
      { today },
    );
    expect(result.draft).toEqual(previous);
    expect(result.changed).toEqual([]);
    expect(result.rejected).toEqual(['date', 'time']);
  });

  it('clear ou absent : comportement inchangé', () => {
    for (const understanding of [undefined, 'clear' as const]) {
      const result = applyProposedDraft(
        previous,
        output({ draft: proposed, ...(understanding ? { understanding } : {}) }),
        { today },
      );
      expect(result.changed).toEqual(['date', 'time']);
    }
  });

  it('doubtful : aucune action, pas même une vérification de disponibilité', () => {
    const state = createStructuredTurnState();
    const draft = { date: '2026-09-27', time: '20:00', partySize: 2, customerName: '' };
    for (const action of ['check_availability', 'take_message', 'transfer', 'end_call'] as const) {
      expect(
        authorizeStructuredAction(state, output({ action, understanding: 'doubtful' }), draft, {
          maxPartySize: 7,
        }),
      ).toEqual({ allowed: false, reason: 'doubtful_understanding' });
    }
    expect(
      authorizeStructuredAction(state, output({ understanding: 'doubtful' }), draft, {
        maxPartySize: 7,
      }),
    ).toEqual({ allowed: true });
  });

  it("le prompt n'ajoute les consignes que sous le drapeau, et sans phrase à imiter", () => {
    const input = {
      systemPrompt: 'Tu es un agent.',
      history: [],
      transcript: 'bonjour',
      state: createStructuredTurnState(),
    };
    const off = buildStructuredTurnMessages(input)[0].content as string;
    const on = buildStructuredTurnMessages({ ...input, understanding: true })[0].content as string;
    expect(off).not.toContain('COMPRÉHENSION VÉRIFIÉE');
    expect(on).toContain('COMPRÉHENSION VÉRIFIÉE');
    // Aucun guillemet français dans le bloc : pas d'exemple de formulation.
    const block = on.slice(on.indexOf('COMPRÉHENSION VÉRIFIÉE'), on.indexOf('ÉTAT VÉRIFIÉ'));
    expect(block).not.toMatch(/[«»]/);
  });

  it('drapeau par restaurant : vide = aucun', () => {
    const env = { VOICE_UNDERSTANDING_CHECK_RESTAURANT_IDS: 'a, b' } as NodeJS.ProcessEnv;
    expect(isVoiceUnderstandingCheckEnabled('a', env)).toBe(true);
    expect(isVoiceUnderstandingCheckEnabled('c', env)).toBe(false);
    expect(isVoiceUnderstandingCheckEnabled(undefined, env)).toBe(false);
    expect(isVoiceUnderstandingCheckEnabled('a', {} as NodeJS.ProcessEnv)).toBe(false);
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

describe('reconcileSpelledName', () => {
  const draft = (customerName: string) => ({ date: '', time: '', partySize: 0, customerName });

  it('reads letters and doubles like a caller spells them', () => {
    expect(spelledLettersOf('hoët h o u e t')).toBe('HOUET');
    expect(spelledLettersOf('au nom de a 2 k i f')).toBe('AKKIF');
    expect(spelledLettersOf('4 1 non 5 5')).toBe('');
    expect(spelledLettersOf('oui')).toBe('');
  });

  it('restores letters the model dropped from the name it wrote', () => {
    expect(reconcileSpelledName(draft('Hoët'), 'hoët h o u e t', 'customerName').customerName).toBe(
      'Houet',
    );
    expect(reconcileSpelledName(draft('HOËT'), 'non h o u e t', 'confirmation').customerName).toBe(
      'HOUET',
    );
    expect(
      reconcileSpelledName(draft('AKIF'), 'au nom de a 2 k i f', 'customerName').customerName,
    ).toBe('AKKIF');
  });

  it('leaves a name that already matches, or a false start followed by the right spelling', () => {
    expect(reconcileSpelledName(draft('HOUET'), 'h o u e t', 'customerName').customerName).toBe(
      'HOUET',
    );
    expect(
      reconcileSpelledName(draft('AKKIF'), 'a k f a 2 k i f', 'customerName').customerName,
    ).toBe('AKKIF');
  });

  it('never shortens or replaces a name built over several turns', () => {
    expect(reconcileSpelledName(draft('HOUET'), 'u e t', 'customerName').customerName).toBe(
      'HOUET',
    );
    expect(reconcileSpelledName(draft('Durand'), 'h o u e t', 'customerName').customerName).toBe(
      'Durand',
    );
  });

  it('drops the words glued after the spelling, whatever they are', () => {
    // La garde ne connaît aucun mot : seule la structure compte (lettres épelées + reste séparé).
    for (const glued of ['HOUET DIMANCHE', 'HOUET oui', 'HOUET je souhaite', 'HOUET x']) {
      expect(reconcileSpelledName(draft(glued), 'h o u e t bla', 'customerName').customerName).toBe(
        'HOUET',
      );
    }
    expect(
      reconcileSpelledName(draft('Hoët Houet'), 'hoët h o u e t merci', 'customerNameConfirmation')
        .customerName,
    ).toBe('Hoët Houet');
    expect(
      reconcileSpelledName(draft('Houet Dimanche'), 'h o u e t dimanche', 'confirmation')
        .customerName,
    ).toBe('Houet');
  });

  it('keeps a longer name when it is not the spelling followed by separate words', () => {
    // Complété sans séparation : le modèle a deviné la fin, ce n'est pas un mot collé.
    expect(reconcileSpelledName(draft('DUPONT'), 'd u p o n', 'customerName').customerName).toBe(
      'DUPONT',
    );
    // Reste AVANT l'épellation : pièces d'un nom assemblées sur plusieurs tours.
    expect(reconcileSpelledName(draft('AK KIF'), 'k i f', 'customerName').customerName).toBe(
      'AK KIF',
    );
    expect(
      reconcileSpelledName(draft('Jean HOUET'), 'h o u e t', 'customerName').customerName,
    ).toBe('Jean HOUET');
    // Le nom est exactement l'épellation en plusieurs mots : rien de plus.
    expect(
      reconcileSpelledName(draft('DE LA FONTAINE'), 'd e l a f o n t a i n e', 'customerName')
        .customerName,
    ).toBe('DE LA FONTAINE');
  });

  it('spelledNameFact : dit quand le nom relu diffère des lettres épelées, sans connaître aucun mot', () => {
    const fact = (
      name: string,
      said: string,
      awaiting: StructuredTurnOutput['awaiting'] = 'customerName',
    ) => spelledNameFact(name, said, awaiting);
    // Lettre absente, mot entendu qui l'emporte sur les lettres, mot collé derrière.
    expect(fact('AKIF', 'a 2 k i f')).toContain('customerName = « AKKIF »');
    expect(fact('Hoët', 'hoët h o u e t')).toContain('customerName = « Houet »');
    expect(fact('HOUET DIMANCHE', 'h o u e t dimanche')).toContain('customerName = « HOUET »');
    // Les mêmes lettres, autre casse ou mise en forme : rien à dire.
    expect(fact('HOUET', 'h o u e t')).toBeNull();
    expect(fact('Houet', 'h o u e t')).toBeNull();
    // Mêmes limites que le garde-fou : nom assemblé sur plusieurs tours, nom complété, pas d'épellation.
    expect(fact('AK KIF', 'k i f')).toBeNull();
    expect(fact('DUPONT', 'd u p o n')).toBeNull();
    expect(fact('Durand', 'oui merci')).toBeNull();
    expect(fact('Hoët', 'h o u e t', 'date')).toBeNull();
  });

  it('does nothing when no name was being asked for', () => {
    expect(reconcileSpelledName(draft('Hoët'), 'h o u e t', 'date').customerName).toBe('Hoët');
  });
});
