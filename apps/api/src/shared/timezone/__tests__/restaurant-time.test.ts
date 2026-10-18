import { describe, expect, it } from 'vitest';
import { isSlotPast, isSlotStartPast, utcToZonedParts, zonedTimeToUtc } from '../restaurant-time';

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

describe('isSlotStartPast / isSlotPast : la règle unique « créneau passé »', () => {
  const start = new Date('2026-07-02T17:00:00.000Z'); // 19:00 à Paris

  it('un créneau qui commence exactement maintenant est passé', () => {
    expect(isSlotStartPast(start, new Date('2026-07-02T17:00:00.000Z'))).toBe(true);
  });

  it('une milliseconde avant le début, le créneau est à venir', () => {
    expect(isSlotStartPast(start, new Date('2026-07-02T16:59:59.999Z'))).toBe(false);
  });

  it('après le début, le créneau est passé', () => {
    expect(isSlotStartPast(start, new Date('2026-07-02T17:00:00.001Z'))).toBe(true);
  });

  it('lit l’horloge quand `now` n’est pas fourni', () => {
    expect(isSlotStartPast(new Date(Date.now() - 1000))).toBe(true);
    expect(isSlotStartPast(new Date(Date.now() + 60_000))).toBe(false);
  });

  it('convertit date et heure locales du restaurant, pas celles du serveur', () => {
    // 19:00 à Paris = 17:00 UTC : à 17:30 UTC le créneau est passé, à 16:30 UTC il est à venir.
    expect(
      isSlotPast('2026-07-02', '19:00', 'Europe/Paris', new Date('2026-07-02T17:30:00Z')),
    ).toBe(true);
    expect(
      isSlotPast('2026-07-02', '19:00', 'Europe/Paris', new Date('2026-07-02T16:30:00Z')),
    ).toBe(false);
    // Même instant, autre fuseau : 19:00 à New York = 23:00 UTC, donc encore à venir à 17:30 UTC.
    expect(
      isSlotPast('2026-07-02', '19:00', 'America/New_York', new Date('2026-07-02T17:30:00Z')),
    ).toBe(false);
  });

  it('traite le passage à l’heure d’hiver : 19:00 le 25 octobre 2026 est 18:00 UTC', () => {
    expect(
      isSlotPast('2026-10-25', '19:00', 'Europe/Paris', new Date('2026-10-25T17:59:59Z')),
    ).toBe(false);
    expect(
      isSlotPast('2026-10-25', '19:00', 'Europe/Paris', new Date('2026-10-25T18:00:00Z')),
    ).toBe(true);
  });
});
