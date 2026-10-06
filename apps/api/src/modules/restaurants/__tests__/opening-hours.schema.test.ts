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
});
