import { describe, it, expect } from 'vitest';
import { findIdenticalRespellings } from '../call-report/respelling';

const row = (turnId: string, callerText: string, agentText: string | null = null) => ({
  turnId,
  callerText,
  agentText,
});

describe('findIdenticalRespellings', () => {
  it("repère une suite de lettres relue, non acceptée, puis épelée à l'identique (3ba7c66f)", () => {
    const result = findIdenticalRespellings([
      row(
        't5',
        'de assam a 2 s a m',
        "Pardon, je n'ai pas bien saisi. Pourriez-vous m'épeler le nom ?",
      ),
      row('t6', 'a 2 s a m', 'Je note A, double A, S, A, M. C’est bien ça ?'),
      row('t7', 'ce serait bien au nom de non non'),
      row('t8', 'a'),
      row('t9', 'a 2 s'),
      row('t10', 'm', "Je n'arrive pas à bien suivre l'épellation."),
      row('t12', 'a 2 s a m', 'Je note A, double A, S, A, M. C’est bien ça ?'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      letters: ['a', '2', 's', 'a', 'm'],
      readbackTurnId: 't6',
      secondTurnIds: ['t12'],
    });
    expect(result[0].readbackText).toContain('Je note');
  });

  it('ne signale pas une épellation reprise quand la suite de lettres change (8043662c)', () => {
    const result = findIdenticalRespellings([
      row('t5', "c'est en nom de de assam a 2 s"),
      row('t6', '2 m', "D'accord, Assamm, avec deux m. C'est bien ça ?"),
      row('t7', 'non a 2 s a 2 m', "Donc Assamm, avec deux s et deux m. C'est bien ça ?"),
      row('t8', "oui c'est ça", 'On récapitule.'),
    ]);
    expect(result).toEqual([]);
  });

  it("ne signale pas une épellation identique quand rien n'a été relu (l'agent a seulement demandé de répéter)", () => {
    const result = findIdenticalRespellings([
      row('t1', 'a 2 s a m', "Pardon, je n'ai pas bien saisi. Pouvez-vous répéter ?"),
      row('t2', 'a 2 s a m', 'Merci.'),
    ]);
    expect(result).toEqual([]);
  });

  it('ne signale pas deux épellations différentes', () => {
    const result = findIdenticalRespellings([
      row('t1', 'h o u e t', 'Je répète : H, O, U, E, T. C’est bien ça ?'),
      row('t2', 'h o u e s', 'Je répète : H, O, U, E, S. C’est bien ça ?'),
    ]);
    expect(result).toEqual([]);
  });

  it('exige au moins trois lettres', () => {
    const result = findIdenticalRespellings([
      row('t1', 'a m', 'A, M. C’est bien ça ?'),
      row('t2', 'a m', 'A, M.'),
    ]);
    expect(result).toEqual([]);
  });

  it("n'y voit pas une épellation dans un nombre dit seul", () => {
    expect(
      findIdenticalRespellings([row('t1', '4', 'Quatre.'), row('t2', '4', 'Quatre.')]),
    ).toEqual([]);
  });

  it("garde l'épellation finale même si l'agent n'a pas eu le temps de répondre", () => {
    const result = findIdenticalRespellings([
      row('t1', 'h o u e t', 'Je répète : H, O, U, E, T. C’est bien ça ?'),
      row('t2', 'non h o u e t'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].secondTurnIds).toEqual(['t2']);
  });
});
