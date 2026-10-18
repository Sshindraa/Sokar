import { describe, expect, it } from 'vitest';
import { askedAgainFact } from '../stream/structured-turn/asked-again';

const before = { date: '2026-09-30', time: '', partySize: 0, customerName: '' };
const after = { date: '2026-09-30', time: '20:00', partySize: 0, customerName: '' };
const base = {
  lastAwaiting: 'partySize',
  outputAwaiting: 'partySize',
  changed: ['time'],
  before,
  after,
  timeSlotStillValid: true,
};

describe('askedAgainFact', () => {
  it("ne reprend pas l'heure donnée et ne demande que le nombre, quand la même question revient", () => {
    const fact = askedAgainFact(base);
    expect(fact).toContain("l'heure (20:00)");
    expect(fact).toContain("ne reprends pas ce qu'il vient de dire");
    expect(fact).toContain('pose directement la question sur le nombre de personnes');
    expect(fact).not.toContain('reconnais');
  });

  it("ne fait rien quand l'appelant a répondu à la question attendue", () => {
    expect(
      askedAgainFact({ ...base, changed: ['partySize'], after: { ...after, partySize: 2 } }),
    ).toBeNull();
  });

  it("ne fait rien quand l'appelant n'a rien donné", () => {
    expect(askedAgainFact({ ...base, changed: [] })).toBeNull();
  });

  it('signale un nombre de personnes déjà donné et pourtant redemandé', () => {
    const fact = askedAgainFact({
      lastAwaiting: 'time',
      outputAwaiting: 'partySize',
      changed: ['time'],
      before: { ...before, partySize: 2 },
      after: { ...before, partySize: 2, time: '20:00' },
      timeSlotStillValid: false,
    });
    expect(fact).toContain('ce qui est déjà retenu : le nombre de personnes (2)');
    expect(fact).toContain('Ne le redemande pas');
  });

  it('couvre une heure claire et encore valable, même redemandée sans autre raison', () => {
    const fact = askedAgainFact({
      lastAwaiting: 'partySize',
      outputAwaiting: 'time',
      changed: [],
      before: after,
      after,
      timeSlotStillValid: true,
    });
    expect(fact).toContain("ce qui est déjà retenu : l'heure (20:00)");
  });

  it("rouvre la question quand le créneau n'est plus valable (indisponibilité)", () => {
    expect(
      askedAgainFact({
        lastAwaiting: 'partySize',
        outputAwaiting: 'time',
        changed: [],
        before: after,
        after,
        timeSlotStillValid: false,
      }),
    ).toBeNull();
  });

  it("rouvre la question quand l'heure vient d'être corrigée", () => {
    expect(
      askedAgainFact({
        lastAwaiting: 'partySize',
        outputAwaiting: 'time',
        changed: ['time'],
        before: { ...before, time: '19:00' },
        after,
        timeSlotStillValid: true,
      }),
    ).toBeNull();
  });

  it("ne signale pas une valeur donnée à l'instant : la confirmer reste permis", () => {
    expect(
      askedAgainFact({
        lastAwaiting: 'partySize',
        outputAwaiting: 'time',
        changed: ['time'],
        before,
        after,
        timeSlotStillValid: true,
      }),
    ).toBeNull();
  });

  it("ignore le nom, qui a son circuit d'épellation, et les réponses sans champ attendu", () => {
    expect(
      askedAgainFact({ ...base, lastAwaiting: 'customerName', outputAwaiting: 'customerName' }),
    ).toBeNull();
    expect(askedAgainFact({ ...base, outputAwaiting: 'open' })).toBeNull();
  });
});
