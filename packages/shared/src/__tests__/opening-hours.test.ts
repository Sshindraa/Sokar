import { describe, expect, it } from 'vitest';
import { bookingSlotsOf, lastBookingOf, normalizeOpeningHours } from '../utils/opening-hours';

describe('normalizeOpeningHours', () => {
  it('keeps the legacy single-service format', () => {
    expect(normalizeOpeningHours({ mon: { open: '12:00', close: '22:00' } })).toEqual([
      { dayIndex: 1, open: '12:00', close: '22:00' },
    ]);
  });

  it('flattens both services while retaining the day and chronological order', () => {
    expect(
      normalizeOpeningHours({
        tue: {
          open: '12:00',
          close: '22:30',
          services: [
            { open: '12:00', close: '14:30' },
            { open: '19:00', close: '22:30' },
          ],
        },
      }),
    ).toEqual([
      { dayIndex: 2, open: '12:00', close: '14:30' },
      { dayIndex: 2, open: '19:00', close: '22:30' },
    ]);
  });

  it('reads onboarding slots as well as legacy services', () => {
    expect(
      normalizeOpeningHours({
        thu: {
          open: '12:00',
          close: '22:30',
          slots: [
            { open: '12:00', close: '14:30' },
            { open: '19:00', close: '22:30' },
          ],
        },
      }),
    ).toEqual([
      { dayIndex: 4, open: '12:00', close: '14:30' },
      { dayIndex: 4, open: '19:00', close: '22:30' },
    ]);
  });

  it('continues an overnight service into the following day', () => {
    expect(normalizeOpeningHours({ sat: { open: '19:00', close: '02:00' } })).toEqual([
      { dayIndex: 0, open: '00:00', close: '02:00' },
      { dayIndex: 6, open: '19:00', close: '24:00' },
    ]);
  });
});

describe('lastBooking in normalizeOpeningHours', () => {
  it('carries lastBooking on each service of a split day', () => {
    expect(
      normalizeOpeningHours({
        tue: {
          open: '12:00',
          close: '22:30',
          slots: [
            { open: '12:00', close: '14:30', lastBooking: '14:00' },
            { open: '19:00', close: '22:30', lastBooking: '21:30' },
          ],
        },
      }),
    ).toEqual([
      { dayIndex: 2, open: '12:00', close: '14:30', lastBooking: '14:00' },
      { dayIndex: 2, open: '19:00', close: '22:30', lastBooking: '21:30' },
    ]);
  });

  it('carries the day-level lastBooking of a continuous service', () => {
    expect(
      normalizeOpeningHours({ mon: { open: '12:00', close: '23:00', lastBooking: '21:30' } }),
    ).toEqual([{ dayIndex: 1, open: '12:00', close: '23:00', lastBooking: '21:30' }]);
  });

  it('ignores a malformed lastBooking', () => {
    expect(
      normalizeOpeningHours({ mon: { open: '12:00', close: '23:00', lastBooking: 'tard' } }),
    ).toEqual([{ dayIndex: 1, open: '12:00', close: '23:00' }]);
  });

  it('keeps an overnight lastBooking before midnight on the opening day', () => {
    expect(
      normalizeOpeningHours({ sat: { open: '19:00', close: '02:00', lastBooking: '23:00' } }),
    ).toEqual([
      { dayIndex: 0, open: '00:00', close: '02:00', lastBooking: null },
      { dayIndex: 6, open: '19:00', close: '24:00', lastBooking: '23:00' },
    ]);
  });

  it('moves an overnight lastBooking after midnight onto the following day', () => {
    expect(
      normalizeOpeningHours({ sat: { open: '19:00', close: '02:00', lastBooking: '01:00' } }),
    ).toEqual([
      { dayIndex: 0, open: '00:00', close: '02:00', lastBooking: '01:00' },
      { dayIndex: 6, open: '19:00', close: '24:00' },
    ]);
  });
});

describe('bookingSlotsOf / lastBookingOf', () => {
  it('defaults to the last 30-minute slot that fits before closing', () => {
    expect(bookingSlotsOf({ open: '19:00', close: '22:30' }).at(-1)).toBe('22:00');
    expect(lastBookingOf({ open: '19:00', close: '22:45' })).toBe('22:00');
    expect(bookingSlotsOf({ open: '12:00', close: '14:30' })).toEqual([
      '12:00',
      '12:30',
      '13:00',
      '13:30',
      '14:00',
    ]);
  });

  it('stops at an explicit lastBooking, inclusive', () => {
    const slots = bookingSlotsOf({ open: '19:00', close: '23:00', lastBooking: '21:30' });
    expect(slots.at(0)).toBe('19:00');
    expect(slots.at(-1)).toBe('21:30');
    expect(slots).toHaveLength(6);
  });

  it('never goes past closing, whatever lastBooking says', () => {
    expect(bookingSlotsOf({ open: '19:00', close: '21:00', lastBooking: '23:00' }).at(-1)).toBe(
      '20:30',
    );
  });

  it('returns no slot when the period is not bookable', () => {
    expect(bookingSlotsOf({ open: '00:00', close: '02:00', lastBooking: null })).toEqual([]);
    expect(lastBookingOf({ open: '00:00', close: '02:00', lastBooking: null })).toBeNull();
  });

  it('handles a period running to 24:00', () => {
    expect(lastBookingOf({ open: '19:00', close: '24:00' })).toBe('23:30');
  });
});
