import { describe, expect, it } from 'vitest';
import { correctPhoneReservationInstant } from '../phone-reservation-timezone-fix';

describe('correctPhoneReservationInstant', () => {
  it('recale une réservation de 20 h enregistrée par un serveur en UTC (heure d’été)', () => {
    // Ancien code sur un serveur UTC : « 20:00 » stocké comme 20:00 UTC.
    const stored = new Date('2026-07-10T20:00:00.000Z');
    const fix = correctPhoneReservationInstant(stored, 'UTC', 'Europe/Paris');
    expect(fix.localDate).toBe('2026-07-10');
    expect(fix.localTime).toBe('20:00');
    expect(fix.corrected.toISOString()).toBe('2026-07-10T18:00:00.000Z');
    expect(fix.shiftMs).toBe(-2 * 60 * 60 * 1000);
  });

  it('applique 1 h de décalage en hiver', () => {
    const fix = correctPhoneReservationInstant(
      new Date('2026-01-15T20:00:00.000Z'),
      'UTC',
      'Europe/Paris',
    );
    expect(fix.corrected.toISOString()).toBe('2026-01-15T19:00:00.000Z');
    expect(fix.shiftMs).toBe(-60 * 60 * 1000);
  });

  it('ne change rien si le serveur était déjà dans le fuseau du restaurant', () => {
    const stored = new Date('2026-07-10T18:00:00.000Z'); // 20:00 à Paris
    const fix = correctPhoneReservationInstant(stored, 'Europe/Paris', 'Europe/Paris');
    expect(fix.shiftMs).toBe(0);
    expect(fix.corrected.toISOString()).toBe(stored.toISOString());
  });

  it('garde la date locale même quand le décalage change de jour', () => {
    // 00:30 à New York voulu, stocké 00:30 UTC par un serveur UTC.
    const fix = correctPhoneReservationInstant(
      new Date('2026-07-11T00:30:00.000Z'),
      'UTC',
      'America/New_York',
    );
    expect(fix.localDate).toBe('2026-07-11');
    expect(fix.corrected.toISOString()).toBe('2026-07-11T04:30:00.000Z');
  });
});
