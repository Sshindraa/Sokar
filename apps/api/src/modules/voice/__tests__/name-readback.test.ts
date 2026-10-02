import { describe, expect, it } from 'vitest';
import {
  fillReadbackMarker,
  hasReadbackMarker,
  nameReadback,
  readbackFact,
  READBACK_MARKER,
  sayCarriesReadback,
} from '../stream/structured-turn/name-readback';

describe('nameReadback : les lettres du nom, lues une à une', () => {
  it('lit les lettres en majuscules séparées par des virgules, une lettre doublée dite « deux X »', () => {
    expect(nameReadback('ASSAM')).toBe('A, deux S, A, M');
    expect(nameReadback('Assamm')).toBe('A, deux S, A, deux M');
    expect(nameReadback('AKKIF')).toBe('A, deux K, I, F');
    expect(nameReadback('Houet')).toBe('H, O, U, E, T');
    expect(nameReadback('Massonn')).toBe('M, A, deux S, O, deux N');
  });

  it('dit « trois » pour trois lettres de suite, et répète au-delà', () => {
    expect(nameReadback('AAAB')).toBe('trois A, B');
    expect(nameReadback('ABBBBC')).toBe('A, B, B, B, B, C');
  });

  it('ignore accents, majuscules et ponctuation ; sépare les mots d’un nom composé par un point', () => {
    expect(nameReadback('Hoët')).toBe('H, O, E, T');
    expect(nameReadback('de la Fontaine')).toBe('D, E. L, A. F, O, N, T, A, I, N, E');
    expect(nameReadback('Jean-Pierre')).toBe('J, E, A, N. P, I, E, deux R, E');
    expect(nameReadback("D'Alembert")).toBe('D. A, L, E, M, B, E, R, T');
  });

  it('ne lit rien quand le nom n’a aucune lettre', () => {
    expect(nameReadback('')).toBeNull();
    expect(nameReadback('  42 ')).toBeNull();
  });

  it('ne produit jamais une lettre seule en minuscule ni en toutes lettres : la voix lirait « secondes », « mètres »', () => {
    for (const name of ['ASSAM', 'Massonn', 'Smith', 'Lemmet', 'Dupont']) {
      const readback = nameReadback(name)!;
      expect(readback).toBe(readback.replace(/\b[a-z]\b/g, (letter) => letter.toUpperCase()));
      // Les seuls mots entiers sont les comptes de répétition.
      expect(readback.replace(/\b(deux|trois)\b/g, '').match(/\b[A-Za-zÀ-ÿ]{2,}\b/)).toBeNull();
    }
  });
});

describe('marqueur de relecture', () => {
  it('remplace le marqueur par les lettres, quelle que soit sa casse ou ses espaces', () => {
    for (const marker of [READBACK_MARKER, '[[nom]]', '[[ NOM ]]']) {
      expect(fillReadbackMarker(`Je note ${marker}. C'est bien ça ?`, 'ASSAM')).toBe(
        "Je note A, deux S, A, M. C'est bien ça ?",
      );
    }
  });

  it('retire le marqueur quand le nom n’a aucune lettre', () => {
    expect(fillReadbackMarker(`Je note ${READBACK_MARKER}. Merci.`, '')).toBe('Je note . Merci.');
  });

  it('reconnaît le marqueur, ou déjà les lettres exactes du nom', () => {
    expect(hasReadbackMarker(`Donc ${READBACK_MARKER} ?`)).toBe(true);
    expect(sayCarriesReadback(`Donc ${READBACK_MARKER}. C'est bien ça ?`, 'ASSAM')).toBe(true);
    expect(sayCarriesReadback("Donc A, deux S, A, M. C'est bien ça ?", 'ASSAM')).toBe(true);
    expect(sayCarriesReadback("Donc Assam, avec deux s. C'est bien ça ?", 'ASSAM')).toBe(false);
    // Les lettres d'un autre nom, ou en minuscules, ne comptent pas.
    expect(sayCarriesReadback("Donc A, deux S, A, deux M. C'est bien ça ?", 'ASSAM')).toBe(false);
    expect(sayCarriesReadback("Donc a, deux s, a, m. C'est bien ça ?", 'ASSAM')).toBe(false);
  });

  it('le fait du second passage nomme le marqueur et le nom retenu, sans exemple de phrase', () => {
    const fact = readbackFact('Assamm');
    expect(fact).toContain(READBACK_MARKER);
    expect(fact).toContain('« Assamm »');
    expect(fact).toContain('awaiting=customerNameConfirmation');
    expect(fact).not.toContain('deux S');
  });
});
