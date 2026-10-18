import { describe, expect, it } from 'vitest';
import { OpeningHoursSchema } from '../opening-hours.schema';

describe('OpeningHoursSchema', () => {
  it('accepts split reservation windows and preserves slots', () => {
    const parsed = OpeningHoursSchema.safeParse({
      thu: {
        open: '12:00',
        close: '22:30',
        slots: [
          { open: '12:00', close: '14:30' },
          { open: '19:00', close: '22:30' },
        ],
      },
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.thu).toHaveProperty('slots');
  });

  it('continues to accept the legacy services property', () => {
    expect(
      OpeningHoursSchema.safeParse({
        thu: {
          open: '12:00',
          close: '22:30',
          services: [
            { open: '12:00', close: '14:30' },
            { open: '19:00', close: '22:30' },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects overlapping windows and an invalid close', () => {
    expect(
      OpeningHoursSchema.safeParse({
        thu: {
          open: '12:00',
          close: '22:00',
          slots: [
            { open: '12:00', close: '14:30' },
            { open: '14:00', close: '22:00' },
          ],
        },
      }).success,
    ).toBe(false);
    expect(OpeningHoursSchema.safeParse({ thu: { open: '22:00', close: '21:00' } }).success).toBe(
      false,
    );
  });

  it('accepts a close before 06:00 the following day', () => {
    expect(
      OpeningHoursSchema.safeParse({
        thu: {
          open: '19:00',
          close: '02:00',
          slots: [{ open: '19:00', close: '02:00' }],
        },
      }).success,
    ).toBe(true);
  });

  it('rejects more than two slots', () => {
    expect(
      OpeningHoursSchema.safeParse({
        thu: {
          open: '12:00',
          close: '22:00',
          slots: [
            { open: '12:00', close: '14:00' },
            { open: '16:00', close: '18:00' },
            { open: '19:00', close: '22:00' },
          ],
        },
      }).success,
    ).toBe(false);
  });
  describe('lastBooking', () => {
    const split = (first: string, second: string) => ({
      thu: {
        open: '12:00',
        close: '22:30',
        slots: [
          { open: '12:00', close: '14:30', lastBooking: first },
          { open: '19:00', close: '22:30', lastBooking: second },
        ],
      },
    });

    it('preserves lastBooking on each service', () => {
      const parsed = OpeningHoursSchema.safeParse(split('14:00', '21:30'));
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.thu?.slots?.map((slot) => slot.lastBooking)).toEqual(['14:00', '21:30']);
      }
    });

    it('preserves the day-level lastBooking of a continuous service', () => {
      const parsed = OpeningHoursSchema.safeParse({
        thu: { open: '12:00', close: '23:00', lastBooking: '21:30' },
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.thu?.lastBooking).toBe('21:30');
    });

    it('still accepts services without lastBooking', () => {
      expect(OpeningHoursSchema.safeParse({ thu: { open: '12:00', close: '22:00' } }).success).toBe(
        true,
      );
    });

    it('rejects a lastBooking outside the service, off the 30-minute grid or at closing', () => {
      expect(OpeningHoursSchema.safeParse(split('11:30', '21:30')).success).toBe(false);
      expect(OpeningHoursSchema.safeParse(split('14:30', '21:30')).success).toBe(false);
      expect(OpeningHoursSchema.safeParse(split('14:15', '21:30')).success).toBe(false);
      expect(OpeningHoursSchema.safeParse(split('14:00', '22:30')).success).toBe(false);
      expect(OpeningHoursSchema.safeParse(split('14:00', 'tard')).success).toBe(false);
    });

    it('accepts an overnight lastBooking before or after midnight', () => {
      for (const lastBooking of ['23:30', '01:00']) {
        expect(
          OpeningHoursSchema.safeParse({
            fri: { open: '19:00', close: '02:00', lastBooking },
          }).success,
        ).toBe(true);
      }
      expect(
        OpeningHoursSchema.safeParse({
          fri: { open: '19:00', close: '02:00', lastBooking: '02:00' },
        }).success,
      ).toBe(false);
    });

    it('rejects a day-level lastBooking that disagrees with the last service', () => {
      const day = split('14:00', '21:30').thu;
      expect(OpeningHoursSchema.safeParse({ thu: { ...day, lastBooking: '21:00' } }).success).toBe(
        false,
      );
      expect(OpeningHoursSchema.safeParse({ thu: { ...day, lastBooking: '21:30' } }).success).toBe(
        true,
      );
    });
  });
});
