import { describe, expect, it } from 'vitest';
import { normalizeOpeningHours } from '../utils/opening-hours';

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
