import { describe, it, expect } from 'vitest';

// On teste la logique de parsing des réponses SMS.
// Le handler complet nécessite Telnyx + DB, on teste juste le parsing ici.

const POSITIVE_PATTERNS = /\b(oui|ok|confirme?|yes|ouais)\b/i;
const NEGATIVE_PATTERNS = /\b(non|annul\w*|cancel\w*|no\b)\b/i;

function parseReply(text: string): 'CONFIRMED' | 'CANCELLED' | 'UNKNOWN' {
  const trimmed = text.trim();
  if (POSITIVE_PATTERNS.test(trimmed)) return 'CONFIRMED';
  if (NEGATIVE_PATTERNS.test(trimmed)) return 'CANCELLED';
  return 'UNKNOWN';
}

describe('SMS reply parser', () => {
  describe('positive replies (CONFIRMED)', () => {
    it.each(['OUI', 'oui', 'Oui', 'OK', 'ok', 'Yes', 'yes', 'Confirmé', 'confirme', 'Ouais'])(
      'parses "%s" as CONFIRMED',
      (input) => {
        expect(parseReply(input)).toBe('CONFIRMED');
      },
    );
  });

  describe('negative replies (CANCELLED)', () => {
    it.each(['NON', 'non', 'Non', 'Annulé', 'annule', 'annulation', 'Cancel', 'cancelled', 'no'])(
      'parses "%s" as CANCELLED',
      (input) => {
        expect(parseReply(input)).toBe('CANCELLED');
      },
    );
  });

  describe('unknown replies', () => {
    it.each(['bonjour', 'peut-être', '31200', 'à 19h', '', 'merci', 'je rappellerai'])(
      'parses "%s" as UNKNOWN',
      (input) => {
        expect(parseReply(input)).toBe('UNKNOWN');
      },
    );
  });

  describe('edge cases', () => {
    it('handles "oui non" ambiguity — positive wins (first match)', () => {
      // POSITIVE_PATTERNS is checked first, so "oui" wins
      expect(parseReply('oui non')).toBe('CONFIRMED');
    });

    it('handles extra whitespace', () => {
      expect(parseReply('  OUI  ')).toBe('CONFIRMED');
      expect(parseReply('  non  ')).toBe('CANCELLED');
    });

    it('handles mixed case', () => {
      expect(parseReply('oUi')).toBe('CONFIRMED');
      expect(parseReply('nOn')).toBe('CANCELLED');
    });

    it('handles "annulation" (noun form)', () => {
      expect(parseReply('annulation')).toBe('CANCELLED');
    });

    it('handles "confirmé" with accent', () => {
      expect(parseReply('confirmé')).toBe('CONFIRMED');
    });
  });
});
