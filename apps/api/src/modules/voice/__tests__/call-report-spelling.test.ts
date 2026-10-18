import { describe, it, expect } from 'vitest';
import { findSplitSpellings } from '../call-report/spelling';

const turn = (turnId: string, callerText: string) => ({ turnId, callerText });

describe('findSplitSpellings', () => {
  it('repère une épellation répartie sur plusieurs tours (lettres seules à chaque tour)', () => {
    const result = findSplitSpellings([
      turn('t1', 'ce serait bien au nom de non non'),
      turn('t2', 'a'),
      turn('t3', 'a 2 s'),
      turn('t4', 'm'),
      turn('t5', 'oui'),
    ]);
    expect(result).toEqual([{ turnIds: ['t2', 't3', 't4'], texts: ['a', 'a 2 s', 'm'] }]);
  });

  it('ne signale pas un seul tour fait de lettres', () => {
    expect(
      findSplitSpellings([turn('t1', 'bonjour'), turn('t2', 'a 2 s a m'), turn('t3', 'oui')]),
    ).toEqual([]);
  });

  it('ne signale pas deux « oui » ou deux chiffres consécutifs comme une épellation', () => {
    expect(findSplitSpellings([turn('t1', '5'), turn('t2', '2')])).toEqual([]);
  });

  it('ignore les tours vides entre deux fragments', () => {
    const result = findSplitSpellings([turn('t1', 'a 2 s'), turn('t2', ''), turn('t3', 'm')]);
    expect(result).toHaveLength(1);
    expect(result[0].turnIds).toEqual(['t1', 't3']);
  });
});
