import { describe, expect, it } from 'vitest';
import {
  buildDeepgramKeyterms,
  DEEPGRAM_KEYTERM_MAX_TERMS,
  DEEPGRAM_KEYTERM_TOKEN_BUDGET,
} from '../stream/stt-deepgram-keyterms';

describe('buildDeepgramKeyterms', () => {
  it('génère des termes par restaurant sans les limites de Scribe', () => {
    const keyterms = buildDeepgramKeyterms({
      restaurantName: 'Le Comptoir des Saveurs du Sud',
      neighborhood: 'Vieux-Port',
      menuTerms: ['bouillabaisse maison'],
      cuisineTypes: ['Cuisine provençale'],
    });

    expect(keyterms).toEqual([
      'Le Comptoir des Saveurs du Sud',
      'bouillabaisse maison',
      'Vieux-Port',
      'Cuisine provençale',
    ]);
    expect(keyterms[0].length).toBeGreaterThan(20);
  });

  it('dédoublonne sans distinguer la casse et reste sous le budget Deepgram', () => {
    const keyterms = buildDeepgramKeyterms(
      {
        restaurantName: 'Chez Exemple',
        menuTerms: ['Chez Exemple', 'Plat du jour', 'Spécialité régionale'],
        cuisineTypes: ['Cuisine méditerranéenne'],
      },
      12,
    );

    expect(keyterms).toEqual(['Chez Exemple', 'Plat du jour']);
    expect(
      keyterms.reduce(
        (total, term) => total + (term.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)?.length ?? 0),
        0,
      ),
    ).toBeLessThanOrEqual(12);
    expect(DEEPGRAM_KEYTERM_TOKEN_BUDGET).not.toBe(50);
    expect(keyterms.length).toBeLessThanOrEqual(DEEPGRAM_KEYTERM_MAX_TERMS);
  });

  it('exclut coordonnées et valeurs trop longues', () => {
    expect(
      buildDeepgramKeyterms({
        restaurantName: 'Chez Exemple',
        menuTerms: ['contact@example.invalid', '+33 6 12 34 56 78', 'x'.repeat(121)],
      }),
    ).toEqual(['Chez Exemple']);
  });

  it('respecte un budget nul ou invalide sans générer de termes', () => {
    expect(buildDeepgramKeyterms({ restaurantName: 'Chez Exemple' }, 0)).toEqual([]);
    expect(buildDeepgramKeyterms({ restaurantName: 'Chez Exemple' }, -1)).toEqual([]);
  });
});
