import { describe, it, expect } from 'vitest';
import { detectOutcome, hadReservationIntent } from '../outcome';

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

describe('hadReservationIntent', () => {
  it('true: le client a parlé de réserver une table', () => {
    expect(
      hadReservationIntent({
        transcript: 'Bonjour, je voudrais réserver une table pour 4 personnes',
        endedReason: 'customer-ended-call',
      }),
    ).toBe(true);
  });

  it('true: demande de disponibilité', () => {
    expect(
      hadReservationIntent({
        transcript: 'Vous êtes disponibles demain à 20h ?',
        endedReason: 'customer-ended-call',
      }),
    ).toBe(true);
  });

  it('true: heure précise mentionnée', () => {
    expect(
      hadReservationIntent({
        transcript: 'Est-ce que je peux venir à 19h30 ?',
        endedReason: 'customer-ended-call',
      }),
    ).toBe(true);
  });

  it('false: seulement demandé les horaires', () => {
    expect(
      hadReservationIntent({
        transcript: 'Quels sont vos horaires ?',
        endedReason: 'customer-ended-call',
      }),
    ).toBe(false);
  });

  it('false: pas de transcript', () => {
    expect(
      hadReservationIntent({
        transcript: undefined,
        endedReason: 'customer-ended-call',
      }),
    ).toBe(false);
  });

  it('false: endedReason no-answer/busy/cancel → on ne spam pas', () => {
    expect(
      hadReservationIntent({
        transcript: 'je voudrais réserver une table',
        endedReason: 'no-answer',
      }),
    ).toBe(false);
    expect(
      hadReservationIntent({
        transcript: 'je voudrais réserver une table',
        endedReason: 'busy',
      }),
    ).toBe(false);
    expect(
      hadReservationIntent({
        transcript: 'je voudrais réserver une table',
        endedReason: 'cancel',
      }),
    ).toBe(false);
  });

  it('true: booking en anglais (multilingue light)', () => {
    expect(
      hadReservationIntent({
        transcript: 'I would like to book a table for 2',
        endedReason: 'customer-ended-call',
      }),
    ).toBe(true);
  });
});
