import { describe, expect, it } from 'vitest';
import { normalizePhone } from '../normalize';

describe('normalizePhone', () => {
  it('conserve un numéro déjà en format E.164', () => {
    expect(normalizePhone('+33612345678')).toBe('+33612345678');
  });

  it('convertit un numéro français à 10 chiffres avec leading 0', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('01.23.45.67.89')).toBe('+33123456789');
  });

  it('convertit un double zéro international en +', () => {
    expect(normalizePhone('0033612345678')).toBe('+33612345678');
  });

  it('supprime les caractères non numériques', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('06-12-34-56-78')).toBe('+33612345678');
  });

  it('retourne les chiffres bruts si aucune règle ne correspond', () => {
    expect(normalizePhone('12345')).toBe('12345');
  });
});
