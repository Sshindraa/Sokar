import { describe, expect, it } from 'vitest';
import {
  buildDeepgramCallKeyterms,
  buildDeepgramKeyterms,
  DEEPGRAM_PARTY_SIZE_KEYTERMS,
  DEEPGRAM_RESERVATION_KEYTERMS,
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

  it("place les tailles de groupe en tête d'un appel sans évincer les termes du restaurant", () => {
    const keyterms = buildDeepgramCallKeyterms({
      restaurantName: 'Chez Exemple',
      menuTerms: ['Trois', 'Plat du jour'],
    });

    expect(keyterms.slice(0, DEEPGRAM_PARTY_SIZE_KEYTERMS.length)).toEqual([
      ...DEEPGRAM_PARTY_SIZE_KEYTERMS,
    ]);
    expect(keyterms).toContain('trois');
    expect(keyterms).not.toContain('Trois');
    expect(keyterms).toEqual(expect.arrayContaining(['Chez Exemple', 'Plat du jour']));
    expect(keyterms).not.toContain('un');
  });
});

describe('vocabulaire de réservation', () => {
  it("absent par défaut : les mots-clés de l'appel sont inchangés", () => {
    const sources = { restaurantName: 'Chez Sokar', city: 'Lyon' };
    expect(buildDeepgramCallKeyterms(sources)).toEqual(
      buildDeepgramCallKeyterms(sources, undefined, { reservationVocabulary: false }),
    );
    expect(buildDeepgramCallKeyterms(sources)).not.toContain('réservation');
  });

  it('demandé : placé après les tailles de groupe, avant les termes du restaurant, sans doublon', () => {
    const keyterms = buildDeepgramCallKeyterms(
      { restaurantName: 'Chez Sokar', cuisineTypes: ['Demain', 'bistrot'] },
      undefined,
      { reservationVocabulary: true },
    );
    expect(keyterms.slice(0, DEEPGRAM_PARTY_SIZE_KEYTERMS.length)).toEqual([
      ...DEEPGRAM_PARTY_SIZE_KEYTERMS,
    ]);
    expect(
      keyterms.slice(
        DEEPGRAM_PARTY_SIZE_KEYTERMS.length,
        DEEPGRAM_PARTY_SIZE_KEYTERMS.length + DEEPGRAM_RESERVATION_KEYTERMS.length,
      ),
    ).toEqual([...DEEPGRAM_RESERVATION_KEYTERMS]);
    expect(keyterms).toContain('Chez Sokar');
    expect(keyterms.filter((term) => term.toLowerCase() === 'demain')).toHaveLength(1);
  });
});
