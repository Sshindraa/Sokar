import { describe, expect, it } from 'vitest';
import { initialWeek, PRESETS, toDayHours, validateDay } from './hours';

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
});
