import { describe, expect, it } from 'vitest';
import { toCustomerFacingTime } from '../customer-facing-time';

describe('toCustomerFacingTime', () => {
  it('arrondit toujours au créneau supérieur de cinq minutes', () => {
    expect(toCustomerFacingTime(new Date('2026-07-21T20:08:00.000Z')).toISOString()).toBe(
      '2026-07-21T20:10:00.000Z',
    );
  });

  it('conserve un créneau déjà humainement lisible', () => {
    expect(toCustomerFacingTime(new Date('2026-07-21T20:10:00.000Z')).toISOString()).toBe(
      '2026-07-21T20:10:00.000Z',
    );
  });
});
