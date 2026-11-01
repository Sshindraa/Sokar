import { describe, it, expect } from 'vitest';
import { anchoredIn, numbersIn } from '../grounding';

describe('numbersIn', () => {
  it('lit les milliers groupés et les décimales à la française', () => {
    expect(numbersIn('1 234 couverts, 4,2 de moyenne')).toEqual([1234, 4.2]);
  });
});

describe('anchoredIn', () => {
  it('ancre un chiffre présent dans un résultat d’outil', () => {
    expect(anchoredIn('Vous avez 42 couverts.', [{ result: { covers: 42 } }])).toEqual({
      ok: true,
      unanchored: [],
    });
  });

  it('signale un chiffre absent des données', () => {
    expect(anchoredIn('Vous avez 43 couverts.', [{ result: { covers: 42 } }])).toEqual({
      ok: false,
      unanchored: [43],
    });
  });

  it('ne convertit pas une fraction en pourcentage : « 89 % » ne s’ancre pas sur 0,89', () => {
    expect(anchoredIn('Il y a 89 % de l’écart.', [{ result: { share: 0.89 } }]).ok).toBe(false);
  });

  it('ne compte ni les dates, ni les intervalles, ni les mois AAAA-MM, ni les heures', () => {
    expect(anchoredIn('Du 25 au 31 octobre, à 19 h 30, « 2026-09 ».', [{ result: {} }])).toEqual({
      ok: true,
      unanchored: [],
    });
  });
});
