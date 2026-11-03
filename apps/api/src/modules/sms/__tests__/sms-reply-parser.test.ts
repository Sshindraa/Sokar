import { describe, it, expect } from 'vitest';

import { parseReply } from '../reply-parser';

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
    it('does not act on contradictory responses', () => {
      expect(parseReply('oui non')).toBe('UNKNOWN');
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
