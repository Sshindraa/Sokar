import { describe, expect, it } from 'vitest';
import {
  lettersOnly,
  nameForSpeech,
  nameLetterSequence,
  nameLettersData,
  readbackFact,
  readbackInstruction,
  sayReadsLetters,
} from '../stream/structured-turn/name-readback';

describe('nameLettersData : les lettres du nom en données', () => {
  it('donne chaque lettre et le nombre de fois qu’elle s’écrit de suite', () => {
    expect(nameLettersData('ASSAMM')).toEqual([
      { letter: 'A', count: 1 },
      { letter: 'S', count: 2 },
      { letter: 'A', count: 1 },
      { letter: 'M', count: 2 },
    ]);
    expect(nameLettersData('Houet').map((entry) => entry.count)).toEqual([1, 1, 1, 1, 1]);
    expect(nameLettersData('AAAB')).toEqual([
      { letter: 'A', count: 3 },
      { letter: 'B', count: 1 },
    ]);
  });

  it('ignore accents, majuscules, espaces et ponctuation ; tous les mots d’un nom composé', () => {
    expect(nameLetterSequence('Hoët')).toBe('HOET');
    expect(nameLetterSequence('de la Fontaine')).toBe('DELAFONTAINE');
    expect(nameLetterSequence("D'Alembert")).toBe('DALEMBERT');
    expect(nameLetterSequence('Jean-Pierre')).toBe('JEANPIERRE');
    expect(nameLettersData('  42 ')).toEqual([]);
  });
});

describe('sayReadsLetters : chaque lettre isolée, dans l’ordre', () => {
  it('accepte les lettres isolées, séparées par des virgules, espaces ou points, quelle que soit la casse', () => {
    expect(sayReadsLetters("Je note A, S, S, A, M, M. C'est bien ça ?", 'ASSAMM')).toBe(true);
    expect(sayReadsLetters('Donc a s s a m m, c’est bien ça ?', 'Assamm')).toBe(true);
    expect(sayReadsLetters('H. O. U. E. T. Je me trompe ?', 'HOUET')).toBe(true);
    expect(
      sayReadsLetters('Alors D, E. L, A. F, O, N, T, A, I, N, E, c’est ça ?', 'de la Fontaine'),
    ).toBe(true);
    // Un accent sur une lettre du nom ne change pas la lettre.
    expect(sayReadsLetters('H, O, E, T ?', 'Hoët')).toBe(true);
  });

  it('refuse le nom dit comme un mot, sa graphie décrite, ou une lettre doublée écrite une seule fois', () => {
    expect(sayReadsLetters("Donc Assamm, avec deux s et deux m. C'est bien ça ?", 'ASSAMM')).toBe(
      false,
    );
    expect(sayReadsLetters("Donc A, deux S, A, deux M. C'est bien ça ?", 'ASSAMM')).toBe(false);
    expect(sayReadsLetters("Donc A, S, A, M. C'est bien ça ?", 'ASSAMM')).toBe(false);
    expect(sayReadsLetters("Donc Assamm. C'est bien ça ?", 'ASSAMM')).toBe(false);
  });

  it('refuse des lettres dans le désordre, manquantes, en trop ou séparées par un mot', () => {
    expect(sayReadsLetters('A, S, A, S, M, M ?', 'ASSAMM')).toBe(false);
    expect(sayReadsLetters('A, S, S, A, M ?', 'ASSAMM')).toBe(false);
    expect(sayReadsLetters('A, S, S, et A, M, M ?', 'ASSAMM')).toBe(false);
    expect(sayReadsLetters('A-S-S-A-M-M ?', 'ASSAMM')).toBe(false);
    expect(sayReadsLetters("Donc A, S, S, A, M, M. C'est bien ça ?", '')).toBe(false);
  });

  it('accepte la suite de lettres même entourée d’autres mots, et même précédée d’une autre lettre isolée', () => {
    expect(
      sayReadsLetters("Je vous relis, c'est A, S, S, A, M, M, c'est bien ça ?", 'ASSAMM'),
    ).toBe(true);
    expect(sayReadsLetters('à A, S, S, A, M, M ?', 'ASSAMM')).toBe(true);
  });
});

describe('consigne et fait de relecture', () => {
  it('lettersOnly : les lettres seules, séparées par des virgules', () => {
    expect(lettersOnly('Assamm')).toBe('A, S, S, A, M, M');
    expect(lettersOnly('42')).toBeNull();
  });

  it('la consigne donne les lettres en données et la forme à respecter, sans exemple de phrase', () => {
    const instruction = readbackInstruction('Assamm');
    expect(instruction).toContain('"letter":"S","count":2');
    expect(instruction).toContain('awaiting=customerNameConfirmation');
    expect(instruction).not.toContain('A, S, S');
    expect(readbackFact('Assamm')).toContain('« Assamm »');
  });
});

describe('nameForSpeech : le nom envoyé à la voix en casse de nom propre', () => {
  it('met le nom en casse de nom propre quand la phrase l’écrit en majuscules (appel 935ff343 : « H… Huey »)', () => {
    expect(nameForSpeech('Une table pour 3 demain à 21 heures, au nom de HOUET.', 'HOUET')).toBe(
      'Une table pour 3 demain à 21 heures, au nom de Houet.',
    );
    expect(nameForSpeech('Au nom de ÉLODIE DUPONT ?', 'Élodie Dupont')).toBe(
      'Au nom de Élodie Dupont ?',
    );
    expect(nameForSpeech('Au nom de D’ALEMBERT ?', "D'ALEMBERT")).toBe('Au nom de D’Alembert ?');
    expect(nameForSpeech('Au nom de JEAN-PIERRE ?', 'JEAN-PIERRE')).toBe('Au nom de Jean-Pierre ?');
  });

  it('ne touche ni les lettres lues une à une, ni les mots qui ne sont pas le nom, ni un nom déjà en casse normale', () => {
    expect(nameForSpeech("Je répète le nom : H, O, U, E, T. C'est bien ça ?", 'HOUET')).toBe(
      "Je répète le nom : H, O, U, E, T. C'est bien ça ?",
    );
    expect(nameForSpeech('Un SMS est envoyé au nom de Houet.', 'HOUET')).toBe(
      'Un SMS est envoyé au nom de Houet.',
    );
    expect(nameForSpeech('Au nom de Houet.', 'HOUET')).toBe('Au nom de Houet.');
    expect(nameForSpeech('Au nom de HOUET.', '')).toBe('Au nom de HOUET.');
  });
});
