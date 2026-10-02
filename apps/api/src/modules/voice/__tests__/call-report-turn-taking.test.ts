import { describe, it, expect } from 'vitest';
import { findOverlaps, unfinishedVerdicts, classifyInterruption } from '../call-report/turn-taking';

describe('findOverlaps', () => {
  it("repère l'agent qui parle sur l'appelant plus de 300 ms", () => {
    const overlaps = findOverlaps([[1, 5]], [[4.2, 8]]);
    expect(overlaps).toEqual([
      { startSec: 4.2, endSec: 5, durationSec: 0.8, interrupter: 'agent' },
    ]);
  });

  it("repère l'appelant qui parle sur l'agent", () => {
    const overlaps = findOverlaps([[4.2, 8]], [[1, 5]]);
    expect(overlaps[0]).toMatchObject({ interrupter: 'caller', durationSec: 0.8 });
  });

  it('ignore un chevauchement de 300 ms ou moins', () => {
    expect(findOverlaps([[1, 5]], [[4.7, 8]])).toEqual([]);
    expect(findOverlaps([[1, 5]], [[5, 8]])).toEqual([]);
  });
});

describe('unfinishedVerdicts', () => {
  const turn = (overrides = {}) => ({
    turnId: 't1',
    callerText: 'je voudrais réserver',
    judgedIncomplete: true,
    callerEndSec: 10,
    agentStartSec: 13 as number | null,
    ...overrides,
  });

  it("dit que l'appelant n'a pas repris quand sa piste reste muette pendant l'attente", () => {
    const [verdict] = unfinishedVerdicts([turn()], [[5, 10]]);
    expect(verdict).toMatchObject({ turnId: 't1', callerResumed: false, waitedSec: 3 });
  });

  it("dit que l'appelant a repris quand sa voix revient pendant l'attente", () => {
    const [verdict] = unfinishedVerdicts(
      [turn()],
      [
        [5, 10],
        [11, 12],
      ],
    );
    expect(verdict).toMatchObject({ callerResumed: true });
  });

  it('ne retient que les tours jugés inachevés', () => {
    expect(unfinishedVerdicts([turn({ judgedIncomplete: false })], [[5, 10]])).toEqual([]);
  });

  it("sans réponse de l'agent, l'attente va jusqu'à la fin de la piste appelant connue", () => {
    const [verdict] = unfinishedVerdicts([turn({ agentStartSec: null })], [[5, 10]]);
    expect(verdict.waitedSec).toBeNull();
  });
});

describe('classifyInterruption', () => {
  const callerWords = (text: string, start: number) =>
    text.split(' ').map((word, i) => ({
      text: word,
      start: start + i * 0.3,
      end: start + i * 0.3 + 0.25,
      confidence: 1,
    }));

  it('une interruption est réelle quand la piste appelant porte des mots autour du coup', () => {
    const result = classifyInterruption({
      atSec: 20,
      callerSegments: [[19.5, 21]],
      callerWords: callerWords('non attendez', 19.6),
      agentRecentText: 'je récapitule votre réservation pour demain',
    });
    expect(result.kind).toBe('real');
    expect(result.callerText).toBe('non attendez');
  });

  it("est un écho quand les mots entendus côté appelant reprennent ce que l'agent venait de dire", () => {
    const result = classifyInterruption({
      atSec: 20,
      callerSegments: [[19.5, 21]],
      callerWords: callerWords('je récapitule votre réservation', 19.6),
      agentRecentText: 'je récapitule votre réservation pour demain',
    });
    expect(result.kind).toBe('echo');
  });

  it("est non confirmée quand aucune voix n'est sur la piste appelant", () => {
    const result = classifyInterruption({
      atSec: 20,
      callerSegments: [[1, 2]],
      callerWords: [],
      agentRecentText: 'bonjour',
    });
    expect(result.kind).toBe('unconfirmed');
  });
});
