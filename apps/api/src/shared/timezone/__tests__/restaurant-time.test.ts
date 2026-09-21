import { describe, expect, it } from 'vitest';
import { utcToZonedParts, zonedTimeToUtc } from '../restaurant-time';

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

describe('utcToZonedParts', () => {
  it('rend un créneau Europe/Paris en heure locale d’été', () => {
    expect(utcToZonedParts(new Date('2026-07-02T17:00:00.000Z'), 'Europe/Paris')).toEqual({
      date: '2026-07-02',
      time: '19:00',
    });
  });

  it('rend un créneau Europe/Paris en heure locale d’hiver', () => {
    expect(utcToZonedParts(new Date('2026-01-02T18:00:00.000Z'), 'Europe/Paris')).toEqual({
      date: '2026-01-02',
      time: '19:00',
    });
  });

  it('corrige le jour quand le fuseau local est en retard sur UTC', () => {
    expect(utcToZonedParts(new Date('2026-01-03T00:00:00.000Z'), 'America/New_York')).toEqual({
      date: '2026-01-02',
      time: '19:00',
    });
  });

  it('est l’inverse exact de zonedTimeToUtc', () => {
    const instant = zonedTimeToUtc('2026-07-02', '19:00', 'Europe/Paris');
    expect(utcToZonedParts(instant, 'Europe/Paris')).toEqual({
      date: '2026-07-02',
      time: '19:00',
    });
  });

  it('utilise Europe/Paris par défaut', () => {
    expect(utcToZonedParts(new Date('2026-07-02T17:00:00.000Z'))).toEqual({
      date: '2026-07-02',
      time: '19:00',
    });
  });
});
