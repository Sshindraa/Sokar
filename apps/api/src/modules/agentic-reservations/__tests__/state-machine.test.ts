import { describe, expect, it } from 'vitest';
import {
  assertCanTransition,
  canTransition,
  InvalidStateInvariantError,
  InvalidStateTransitionError,
  isAgenticChannel,
  isTerminalState,
  listAllowedTransitions,
  type ReservationState,
} from '../core/state-machine.js';

describe('state-machine', () => {
  describe('canTransition', () => {
    it('accepte les transitions valides depuis PENDING', () => {
      expect(canTransition('PENDING', 'CONFIRMED')).toBe(true);
      expect(canTransition('PENDING', 'CANCELLED')).toBe(true);
      expect(canTransition('PENDING', 'EXPIRED')).toBe(true);
      expect(canTransition('PENDING', 'FAILED')).toBe(true);
    });

    it('rejette les transitions invalides depuis PENDING', () => {
      expect(canTransition('PENDING', 'SEATED')).toBe(false);
      expect(canTransition('PENDING', 'HONORED')).toBe(false);
      expect(canTransition('PENDING', 'NO_SHOW')).toBe(false);
    });

    it('accepte les transitions valides depuis CONFIRMED', () => {
      expect(canTransition('CONFIRMED', 'SEATED')).toBe(true);
      expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
      expect(canTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
      expect(canTransition('CONFIRMED', 'EXPIRED')).toBe(true);
      expect(canTransition('CONFIRMED', 'FAILED')).toBe(true);
    });

    it('rejette CONFIRMED → PENDING (pas de rollback)', () => {
      expect(canTransition('CONFIRMED', 'PENDING')).toBe(false);
    });

    it('accepte SEATED → HONORED et SEATED → NO_SHOW', () => {
      expect(canTransition('SEATED', 'HONORED')).toBe(true);
      expect(canTransition('SEATED', 'NO_SHOW')).toBe(true);
    });

    it('rejette SEATED → CONFIRMED (impossible de re-confirmer)', () => {
      expect(canTransition('SEATED', 'CONFIRMED')).toBe(false);
    });

    it('HONORED est terminal', () => {
      expect(isTerminalState('HONORED')).toBe(true);
      expect(canTransition('HONORED', 'CANCELLED')).toBe(false);
      expect(canTransition('HONORED', 'NO_SHOW')).toBe(false);
    });

    it('CANCELLED est terminal', () => {
      expect(isTerminalState('CANCELLED')).toBe(true);
      expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
    });

    it('NO_SHOW est terminal', () => {
      expect(isTerminalState('NO_SHOW')).toBe(true);
    });

    it('FAILED est terminal', () => {
      expect(isTerminalState('FAILED')).toBe(true);
    });

    it('EXPIRED est terminal', () => {
      expect(isTerminalState('EXPIRED')).toBe(true);
    });
  });

  describe('assertCanTransition', () => {
    it('passe silencieusement sur transition valide', () => {
      expect(() => assertCanTransition('PENDING', 'CONFIRMED')).not.toThrow();
    });

    it('lève InvalidStateTransitionError sur transition invalide', () => {
      expect(() => assertCanTransition('HONORED', 'CANCELLED')).toThrow(
        InvalidStateTransitionError,
      );
    });

    it('l’erreur contient from et to', () => {
      try {
        assertCanTransition('HONORED', 'CANCELLED');
        expect.fail('aurait dû jeter');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidStateTransitionError);
        const e = err as InvalidStateTransitionError;
        expect(e.from).toBe('HONORED');
        expect(e.to).toBe('CANCELLED');
        expect(e.message).toContain('HONORED');
        expect(e.message).toContain('CANCELLED');
      }
    });
  });

  describe('assertCanTransition with invariants', () => {
    it('lève InvalidStateInvariantError si SEATED sans tableId', () => {
      expect(() =>
        assertCanTransition('CONFIRMED', 'SEATED', { startsAt: new Date('2020-01-01') }),
      ).toThrow(InvalidStateInvariantError);
    });

    it('accepte SEATED avec un tableId', () => {
      expect(() =>
        assertCanTransition('CONFIRMED', 'SEATED', {
          tableId: 'table-1',
          startsAt: new Date('2020-01-01'),
        }),
      ).not.toThrow();
    });

    it('lève InvalidStateInvariantError si HONORED avec startsAt futur', () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(() =>
        assertCanTransition('SEATED', 'HONORED', { tableId: 'table-1', startsAt: future }),
      ).toThrow(InvalidStateInvariantError);
    });

    it('accepte HONORED avec startsAt passé', () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(() =>
        assertCanTransition('SEATED', 'HONORED', { tableId: 'table-1', startsAt: past }),
      ).not.toThrow();
    });

    it('lève InvalidStateInvariantError si NO_SHOW avec startsAt futur', () => {
      const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
      expect(() => assertCanTransition('CONFIRMED', 'NO_SHOW', { startsAt: future })).toThrow(
        InvalidStateInvariantError,
      );
    });

    it('accepte NO_SHOW avec startsAt passé', () => {
      const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
      expect(() => assertCanTransition('CONFIRMED', 'NO_SHOW', { startsAt: past })).not.toThrow();
    });
  });

  describe('listAllowedTransitions', () => {
    it('liste les 4 transitions de PENDING', () => {
      const list = listAllowedTransitions('PENDING');
      expect(list).toHaveLength(4);
      expect(list).toEqual(expect.arrayContaining(['CONFIRMED', 'CANCELLED', 'EXPIRED', 'FAILED']));
    });

    it('retourne un tableau vide pour les états terminaux', () => {
      expect(listAllowedTransitions('HONORED')).toEqual([]);
      expect(listAllowedTransitions('CANCELLED')).toEqual([]);
      expect(listAllowedTransitions('NO_SHOW')).toEqual([]);
      expect(listAllowedTransitions('FAILED')).toEqual([]);
      expect(listAllowedTransitions('EXPIRED')).toEqual([]);
    });
  });

  describe('isAgenticChannel', () => {
    it('API/MCP/OPENAI_RESERVE sont agentic', () => {
      expect(isAgenticChannel('API')).toBe(true);
      expect(isAgenticChannel('MCP')).toBe(true);
      expect(isAgenticChannel('OPENAI_RESERVE')).toBe(true);
    });

    it('PHONE/WEB/ADMIN ne sont pas agentic', () => {
      expect(isAgenticChannel('PHONE')).toBe(false);
      expect(isAgenticChannel('WEB')).toBe(false);
      expect(isAgenticChannel('ADMIN')).toBe(false);
    });
  });

  describe('exhaustivité (8 états)', () => {
    it('couvre tous les états dans la table de transitions', () => {
      const allStates: ReservationState[] = [
        'PENDING',
        'CONFIRMED',
        'SEATED',
        'HONORED',
        'CANCELLED',
        'NO_SHOW',
        'FAILED',
        'EXPIRED',
      ];
      for (const state of allStates) {
        expect(listAllowedTransitions(state)).toBeDefined();
      }
    });
  });
});
