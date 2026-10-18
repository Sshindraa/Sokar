import { describe, expect, it } from 'vitest';
import { scopeReservationArgs } from '../test-reservation-scope';

describe('scopeReservationArgs', () => {
  it('ajoute isTest:false aux lectures en masse', () => {
    expect(scopeReservationArgs('findMany', { where: { restaurantId: 'r' } })).toEqual({
      where: { AND: [{ restaurantId: 'r' }, { isTest: false }] },
    });
    expect(scopeReservationArgs('count', undefined)).toEqual({ where: { isTest: false } });
  });

  it('conserve les autres arguments', () => {
    expect(scopeReservationArgs('findMany', { orderBy: { id: 'asc' } })).toEqual({
      orderBy: { id: 'asc' },
      where: { isTest: false },
    });
  });

  it('laisse passer une requête ciblée par id', () => {
    const args = { where: { id: 'x', restaurantId: 'r' } };
    expect(scopeReservationArgs('updateMany', args)).toBe(args);
  });

  it('laisse passer une requête ciblée par id: { equals }', () => {
    const args = { where: { id: { equals: 'x' } } };
    expect(scopeReservationArgs('findFirst', args)).toBe(args);
  });

  it('filtre une requête qui exclut un id (id: { not })', () => {
    expect(
      scopeReservationArgs('findFirst', { where: { id: { not: 'x' }, restaurantId: 'r' } }),
    ).toEqual({
      where: { AND: [{ id: { not: 'x' }, restaurantId: 'r' }, { isTest: false }] },
    });
  });

  it('filtre une requête sur plusieurs ids (id: { in })', () => {
    expect(scopeReservationArgs('findMany', { where: { id: { in: ['a', 'b'] } } })).toEqual({
      where: { AND: [{ id: { in: ['a', 'b'] } }, { isTest: false }] },
    });
  });

  it('filtre un id: { equals } accompagné d’un autre opérateur', () => {
    expect(scopeReservationArgs('count', { where: { id: { equals: 'x', not: 'y' } } })).toEqual({
      where: { AND: [{ id: { equals: 'x', not: 'y' } }, { isTest: false }] },
    });
  });

  it('laisse passer la purge (id: { in } + isTest)', () => {
    const args = { where: { id: { in: ['a'] }, isTest: true } };
    expect(scopeReservationArgs('deleteMany', args)).toBe(args);
  });

  it('laisse passer une requête qui mentionne isTest', () => {
    const args = { where: { isTest: true } };
    expect(scopeReservationArgs('deleteMany', args)).toBe(args);
  });

  it('ne touche pas findUnique ni create', () => {
    const args = { where: { id: 'x' } };
    expect(scopeReservationArgs('findUnique', args)).toBe(args);
    const data = { data: { a: 1 } };
    expect(scopeReservationArgs('create', data)).toBe(data);
  });
});
