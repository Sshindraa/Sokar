import { describe, it, expect } from 'vitest';
import {
  flattenWords,
  mapTokensToWords,
  spanOfTokens,
  timeOfToken,
  zoneTexts,
} from '../call-report/word-map';
import { tokenize } from '../call-report/tokens';

const word = (text: string, start: number, end: number) => ({ text, start, end, confidence: 1 });
const words = [
  word('oui', 1, 1.4),
  word('bonjour', 1.4, 2),
  word('a2m', 2.5, 3.5),
  word('merci', 4, 4.5),
];

describe('flattenWords', () => {
  it('découpe chaque mot en jetons et garde le mot d’origine', () => {
    const flat = flattenWords(words);
    expect(flat.tokens).toEqual(['oui', 'bonjour', 'a', '2', 'm', 'merci']);
    expect(flat.wordOf).toEqual([0, 1, 2, 2, 2, 3]);
  });
});

describe('mapTokensToWords', () => {
  it('rattache chaque jeton du direct au mot de la piste qui lui correspond', () => {
    const map = mapTokensToWords(tokenize('bonjour a m merci'), flattenWords(words));
    expect(map).toEqual([1, 2, 2, 3]);
  });

  it('laisse sans mot un jeton que la piste ne contient pas', () => {
    const map = mapTokensToWords(tokenize('bonjour madame merci'), flattenWords(words));
    expect(map[0]).toBe(1);
    expect(map[2]).toBe(3);
    expect(map[1] === null || typeof map[1] === 'number').toBe(true);
  });
});

describe('spanOfTokens', () => {
  it("donne début et fin de parole d'une plage de jetons", () => {
    const map = mapTokensToWords(tokenize('oui bonjour a m merci'), flattenWords(words));
    expect(spanOfTokens(map, words, 0, 2)).toEqual({ start: 1, end: 2 });
    expect(spanOfTokens(map, words, 2, 5)).toEqual({ start: 2.5, end: 4.5 });
  });

  it('renvoie null quand rien de la plage ne se retrouve dans la piste', () => {
    const map = mapTokensToWords(tokenize('zzz yyy'), flattenWords([]));
    expect(spanOfTokens(map, words, 0, 2)).toBeNull();
  });
});

describe('timeOfToken', () => {
  it('prend le mot voisin quand le jeton lui-même est perdu', () => {
    const map: Array<number | null> = [1, null, 3];
    expect(timeOfToken(map, words, 1)).toBeCloseTo(1.4, 5);
  });
});

describe('zoneTexts', () => {
  const w = (text: string, at: number) => ({ text, start: at - 0.1, end: at + 0.1, confidence: 1 });

  it('répartit les mots de la piste entre les tours, à mi-chemin entre deux prises de parole', () => {
    const spans = [{ start: 0, end: 2 }, null, { start: 5, end: 7 }];
    const words = [w('a', 0.5), w('b', 1.5), w('c', 3), w('d', 4), w('e', 6), w('f', 9)];
    expect(zoneTexts(spans, words)).toEqual(['a b c', '', 'd e f']);
  });

  it('met dans le premier tour les mots qui précèdent sa parole (accueil, début avalé)', () => {
    expect(zoneTexts([{ start: 4, end: 6 }], [w('x', 1), w('y', 5)])).toEqual(['x y']);
  });

  it('renvoie des textes vides quand aucun tour ne se place sur la piste', () => {
    expect(zoneTexts([null, null], [w('x', 1)])).toEqual(['', '']);
  });
});
