import { describe, expect, it } from 'vitest';
import { zonedTimeToUtc } from '../restaurant-time';

describe('zonedTimeToUtc', () => {
  it('convertit correctement un créneau Europe/Paris en été', () => {
    expect(zonedTimeToUtc('2026-07-02', '19:00', 'Europe/Paris').toISOString()).toBe(
      '2026-07-02T17:00:00.000Z',
    );
  });

  it('convertit correctement un créneau Europe/Paris en hiver', () => {
    expect(zonedTimeToUtc('2026-01-02', '19:00', 'Europe/Paris').toISOString()).toBe(
      '2026-01-02T18:00:00.000Z',
    );
  });

  it('gère un fuseau américain en été', () => {
    expect(zonedTimeToUtc('2026-07-02', '19:00', 'America/New_York').toISOString()).toBe(
      '2026-07-02T23:00:00.000Z',
    );
  });

  it('gère le changement de jour en hiver pour un fuseau américain', () => {
    expect(zonedTimeToUtc('2026-01-02', '19:00', 'America/New_York').toISOString()).toBe(
      '2026-01-03T00:00:00.000Z',
    );
  });
});
