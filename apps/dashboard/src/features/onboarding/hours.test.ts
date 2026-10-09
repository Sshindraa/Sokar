import { describe, expect, it } from 'vitest';
import {
  bookingStarts,
  defaultLastBooking,
  groupWeek,
  initialWeek,
  lastBookingOptions,
  PRESETS,
  slotsOf,
  switchMode,
  toDayHours,
  updateSlot,
  validateDay,
} from './hours';

describe('onboarding hours model', () => {
  it('rejects overlapping services', () => {
    expect(
      validateDay(
        toDayHours([
          { open: '12:00', close: '14:30' },
          { open: '14:00', close: '22:00' },
        ]),
      ),
    ).toContain('chevauchent');
  });

  it('rejects a close before opening unless it is an overnight close', () => {
    expect(validateDay(toDayHours([{ open: '12:00', close: '11:00' }]))).toContain(
      'fermeture doit suivre',
    );
    expect(validateDay(toDayHours([{ open: '22:00', close: '02:00' }]))).toBeNull();
  });

  it('uses the split preset for a new restaurant and retains existing services', () => {
    const days = ['mon', 'tue', 'wed'];
    const defaults = { tue: { open: '12:00', close: '22:00' } };
    const fresh = initialWeek(undefined, defaults, days);
    expect(fresh.mon).toBeNull();
    expect(fresh.tue).toEqual({ open: '12:00', close: '22:30', slots: PRESETS.split });

    const existing = initialWeek(
      {
        tue: {
          open: '12:00',
          close: '22:30',
          services: [
            { open: '12:00', close: '14:30' },
            { open: '19:00', close: '22:30' },
          ],
        },
      },
      defaults,
      days,
    );
    expect(existing.tue).toEqual({ open: '12:00', close: '22:30', slots: PRESETS.split });
  });
  describe('lastBooking', () => {
    it('fills a missing lastBooking with the last slot that fits before closing', () => {
      expect(defaultLastBooking({ open: '19:00', close: '22:30' })).toBe('22:00');
      expect(defaultLastBooking({ open: '19:00', close: '22:45' })).toBe('22:00');
      expect(slotsOf({ open: '12:00', close: '22:00' })[0].lastBooking).toBe('21:30');
    });

    it('lists the 30-minute starts of the service, including after midnight', () => {
      expect(lastBookingOptions({ open: '12:00', close: '14:30' })).toEqual([
        '12:00',
        '12:30',
        '13:00',
        '13:30',
        '14:00',
      ]);
      expect(lastBookingOptions({ open: '23:00', close: '01:00' })).toEqual([
        '23:00',
        '23:30',
        '00:00',
        '00:30',
      ]);
    });

    it('rejects a lastBooking outside the service or off the grid', () => {
      const slot = { open: '19:00', close: '22:30' };
      expect(validateDay(toDayHours([{ ...slot, lastBooking: '22:30' }]))).toContain(
        'dernière réservation',
      );
      expect(validateDay(toDayHours([{ ...slot, lastBooking: '19:15' }]))).toContain(
        'dernière réservation',
      );
      expect(validateDay(toDayHours([{ ...slot, lastBooking: '21:30' }]))).toBeNull();
    });

    it('follows the closing time while it matches the default, otherwise keeps a valid choice', () => {
      const slot = { open: '19:00', close: '22:30', lastBooking: '22:00' };
      expect(updateSlot(slot, 'close', '23:30').lastBooking).toBe('23:00');
      expect(updateSlot({ ...slot, lastBooking: '21:00' }, 'close', '23:30').lastBooking).toBe(
        '21:00',
      );
      expect(updateSlot({ ...slot, lastBooking: '21:00' }, 'close', '20:30').lastBooking).toBe(
        '20:00',
      );
    });

    it('keeps the dinner lastBooking when switching between split and continuous', () => {
      const split = toDayHours([
        { open: '12:00', close: '14:30', lastBooking: '14:00' },
        { open: '19:00', close: '23:00', lastBooking: '21:30' },
      ]);
      const continuous = switchMode(split, 'continuous');
      expect(continuous).toEqual({ open: '12:00', close: '23:00', lastBooking: '21:30' });
      expect(switchMode(continuous, 'split')).toEqual(split);
    });
  });

  describe('aperçu de la semaine', () => {
    const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const split = toDayHours(PRESETS.split);
    const continuous = toDayHours(PRESETS.continuous);

    it('regroupe les jours consécutifs aux mêmes services, et seulement eux', () => {
      const groups = groupWeek(
        { mon: null, tue: split, wed: split, thu: continuous, fri: split, sat: split, sun: null },
        DAYS,
      );
      expect(groups.map((group) => group.days)).toEqual([['tue', 'wed'], ['thu'], ['fri', 'sat']]);
    });

    it('ne regroupe pas deux jours identiques séparés par un jour fermé', () => {
      const groups = groupWeek({ mon: split, tue: null, wed: split }, DAYS);
      expect(groups.map((group) => group.days)).toEqual([['mon'], ['wed']]);
    });

    it('propose les heures de l’ouverture à la dernière réservation incluse', () => {
      expect(bookingStarts({ open: '12:00', close: '14:30', lastBooking: '13:30' })).toEqual([
        '12:00',
        '12:30',
        '13:00',
        '13:30',
      ]);
    });
  });
});
