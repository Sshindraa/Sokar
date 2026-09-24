import { describe, expect, it } from 'vitest';
import {
  confusableNeighbours,
  decideSlotConfidence,
  unstableAlternatives,
  valueConfidence,
} from '../stream/slot-confidence';

describe('confusableNeighbours', () => {
  it.each([
    ['partySize', '6', ['10', '16']],
    ['partySize', '2', ['12']],
    ['partySize', '3', ['13']],
    ['partySize', '5', ['7']],
    ['partySize', '4', []],
    ['time', '20:00', ['21:00', '22:00', '08:00']],
    ['time', '08:00', ['20:00']],
    ['time', '19:15', ['19:30']],
  ] as const)('%s %s → %j', (kind, value, expected) => {
    expect(confusableNeighbours(kind, value)).toEqual(expected);
  });
});

describe('valueConfidence', () => {
  it('prend la confiance la plus faible des mots qui portent la valeur', () => {
    expect(
      valueConfidence('partySize', '6', [
        { word: 'Six', confidence: 0.4 },
        { word: 'personnes', confidence: 0.2 },
      ]),
    ).toBe(0.4);
    expect(valueConfidence('time', '20:15', [{ word: '20h15,', confidence: 0.7 }])).toBe(0.7);
    expect(
      valueConfidence('time', '22:00', [
        { word: 'vingt', confidence: 0.9 },
        { word: 'deux', confidence: 0.3 },
        { word: 'heures', confidence: 0.8 },
      ]),
    ).toBe(0.3);
  });

  it('ne conclut rien sans confiance fournie', () => {
    expect(valueConfidence('partySize', '6', [{ word: 'six' }])).toBeNull();
    expect(valueConfidence('partySize', '6', undefined)).toBeNull();
  });
});

describe('decideSlotConfidence', () => {
  const base = { kind: 'partySize' as const, value: '6', partialAlternatives: [] };

  it('relit seulement une valeur sûre et stable', () => {
    expect(decideSlotConfidence({ ...base, confidence: 0.9 }).decision).toBe('readBack');
  });

  it('propose le voisin confusable quand la confiance est basse', () => {
    expect(decideSlotConfidence({ ...base, confidence: 0.3 })).toMatchObject({
      decision: 'choice',
      choice: ['6', '10'],
    });
  });

  it('propose la valeur vue dans les partielles quand le tour est instable', () => {
    const partialAlternatives = unstableAlternatives('6', ['10', '6', undefined]);
    expect(decideSlotConfidence({ ...base, confidence: 0.95, partialAlternatives })).toMatchObject({
      decision: 'choice',
      choice: ['6', '10'],
      unstable: true,
    });
  });

  it('redemande une valeur très douteuse sans voisin', () => {
    expect(
      decideSlotConfidence({
        kind: 'partySize',
        value: '4',
        confidence: 0.1,
        partialAlternatives: [],
      }).decision,
    ).toBe('reprompt');
  });

  it('n’accepte jamais d’office une heure hors des horaires d’ouverture', () => {
    const openTimes = ['19:00', '20:00', '21:00'];
    expect(
      decideSlotConfidence({
        kind: 'time',
        value: '08:00',
        confidence: 0.99,
        partialAlternatives: [],
        openTimes,
      }),
    ).toMatchObject({ decision: 'choice', choice: ['08:00', '20:00'], outsideOpeningHours: true });
    expect(
      decideSlotConfidence({
        kind: 'time',
        value: '15:00',
        confidence: 0.99,
        partialAlternatives: [],
        openTimes,
      }).decision,
    ).toBe('reprompt');
  });
});
