import { describe, expect, it } from 'vitest';
import { pickVariant } from '../stream/reply-variants';

describe('pickVariant', () => {
  it('ne répète aucune formule tant que toutes n’ont pas servi', () => {
    const session = {};
    const variants = ['A', 'B', 'C'];
    const picks = [1, 2, 3].map(() => pickVariant(session, 'key', variants));
    expect(new Set(picks).size).toBe(3);
  });

  it('ne dit jamais deux fois de suite la même formule, même après épuisement', () => {
    const session = {};
    const variants = ['A', 'B'];
    let previous = '';
    for (let i = 0; i < 10; i++) {
      const pick = pickVariant(session, 'key', variants);
      expect(pick).not.toBe(previous);
      previous = pick;
    }
  });

  it('garde un historique séparé par clé', () => {
    const session = {};
    expect(pickVariant(session, 'merci', ['A', 'B'])).toBe('A');
    expect(pickVariant(session, 'allo', ['A', 'B'])).toBe('A');
  });
});
