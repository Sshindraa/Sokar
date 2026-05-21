import { describe, it, expect } from 'vitest';
import { detectOutcome } from '../outcome';

describe('detectOutcome', () => {
  it('devrait retourner RESERVED quand le transcript confirme une réservation', () => {
    const result = detectOutcome({
      transcript: 'Réservation confirmée pour Dupont, numéro de réservation ABC123',
      endedReason: 'customer-ended-call',
    });
    expect(result).toBe('RESERVED');
  });

  it('devrait retourner HANDOFF quand endedReason est "transfer"', () => {
    const result = detectOutcome({
      transcript: 'Je vous transfère au gérant',
      endedReason: 'transfer',
    });
    expect(result).toBe('HANDOFF');
  });

  it('devrait retourner ERROR quand endedReason est "error"', () => {
    const result = detectOutcome({
      transcript: 'Allô ?',
      endedReason: 'error',
    });
    expect(result).toBe('ERROR');
  });

  it('devrait retourner INFO quand le transcript parle des horaires', () => {
    const result = detectOutcome({
      transcript: 'Nous sommes ouverts du lundi au samedi',
      endedReason: 'customer-ended-call',
    });
    expect(result).toBe('INFO');
  });

  it('devrait retourner NO_ACTION quand rien ne correspond', () => {
    const result = detectOutcome({
      transcript: 'Bonjour, je voudrais des informations',
      endedReason: 'customer-ended-call',
    });
    expect(result).toBe('NO_ACTION');
  });
});
