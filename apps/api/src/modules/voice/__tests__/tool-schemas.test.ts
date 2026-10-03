/**
 * Validation des arguments des trois actions que le tour structuré exécute côté serveur
 * (createReservation, takeMessage, handoffToManager). Une régression ici ferait échouer en silence
 * une réservation ou un transfert : la validation Zod est la dernière barrière avant l'écriture.
 */

import { describe, it, expect } from 'vitest';
import { validateToolArgs, VOICE_TOOL_SCHEMAS } from '../tool-schemas';

describe('registre des actions vocales', () => {
  it('ne porte que les trois actions exécutées par le tour structuré', () => {
    expect(VOICE_TOOL_SCHEMAS.map((tool) => tool.name).sort()).toEqual([
      'createReservation',
      'handoffToManager',
      'takeMessage',
    ]);
  });

  it.each([
    'checkAvailability',
    'cancelReservation',
    'reportDelay',
    'purchaseGiftCard',
    'recommendGiftCardAmount',
  ])("rejette l'ancien outil « %s » : le mode à outils n'existe plus", (name) => {
    expect(validateToolArgs(name, '{}').success).toBe(false);
  });
});

describe('validateToolArgs — arguments valides', () => {
  it.each([
    [
      'createReservation',
      { date: '2024-01-15', time: '19:30', partySize: 4, customerName: 'Marie Dupont' },
    ],
    ['takeMessage', { customerName: 'Marie', message: 'Bonjour' }],
    ['takeMessage', { customerName: 'Marie', message: 'Bonjour', callbackPhone: '+33612345678' }],
    ['handoffToManager', {}],
    ['handoffToManager', null],
  ])('%s accepte des arguments valides', (name, args) => {
    const result = validateToolArgs(name, JSON.stringify(args));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeDefined();
  });
});

describe('validateToolArgs — arguments invalides', () => {
  const reservation = { date: '2024-01-15', time: '19:30', partySize: 2, customerName: 'Marie' };

  it.each([
    ['une heure hors format HH:MM', { ...reservation, time: '25:00' }],
    ['une date hors format AAAA-MM-JJ', { ...reservation, date: '15/01/2024' }],
    ['un nombre de personnes à 0', { ...reservation, partySize: 0 }],
    ['un nombre de personnes à 101', { ...reservation, partySize: 101 }],
    ['un nombre de personnes écrit en texte', { ...reservation, partySize: '2' }],
  ])('createReservation refuse %s', (_label, args) => {
    expect(validateToolArgs('createReservation', JSON.stringify(args)).success).toBe(false);
  });

  it('createReservation refuse un champ obligatoire manquant (customerName)', () => {
    const { customerName: _name, ...withoutName } = reservation;
    expect(validateToolArgs('createReservation', JSON.stringify(withoutName)).success).toBe(false);
  });

  it("renvoie un message d'erreur non vide, sans détail Zod pour l'appelant", () => {
    const result = validateToolArgs('createReservation', JSON.stringify({}));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.length).toBeGreaterThan(0);
  });

  it('refuse un JSON mal formé sans lever', () => {
    expect(validateToolArgs('createReservation', '{not valid json').success).toBe(false);
  });

  it('accepte des arguments vides pour handoffToManager', () => {
    expect(validateToolArgs('handoffToManager', '').success).toBe(true);
  });
});
