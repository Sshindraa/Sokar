import { describe, expect, it } from 'vitest';
import { DEFAULT_RESTAURANT_TIMEZONE, todayInTimezone } from '../restaurant-day';

describe('todayInTimezone', () => {
  it('entre minuit et 2 h à Paris, donne le jour de Paris et non le jour UTC', () => {
    // 00:30 à Paris le 3 juillet = 22:30 UTC le 2 juillet.
    const now = new Date('2026-07-02T22:30:00.000Z');
    expect(now.toISOString().slice(0, 10)).toBe('2026-07-02');
    expect(todayInTimezone('Europe/Paris', now)).toBe('2026-07-03');
  });

  it('change de jour à minuit exactement, heure de Paris', () => {
    expect(todayInTimezone('Europe/Paris', new Date('2026-07-02T21:59:59.999Z'))).toBe(
      '2026-07-02',
    );
    expect(todayInTimezone('Europe/Paris', new Date('2026-07-02T22:00:00.000Z'))).toBe(
      '2026-07-03',
    );
  });

  it('suit l’heure d’hiver : minuit à Paris est 23:00 UTC', () => {
    expect(todayInTimezone('Europe/Paris', new Date('2026-12-01T22:59:59.000Z'))).toBe(
      '2026-12-01',
    );
    expect(todayInTimezone('Europe/Paris', new Date('2026-12-01T23:00:00.000Z'))).toBe(
      '2026-12-02',
    );
  });

  it('se cale sur le fuseau du restaurant, pas sur celui de l’appelant', () => {
    // 22:30 UTC le 2 juillet : encore le 2 à New York, déjà le 3 à Tokyo.
    const now = new Date('2026-07-02T22:30:00.000Z');
    expect(todayInTimezone('America/New_York', now)).toBe('2026-07-02');
    expect(todayInTimezone('Asia/Tokyo', now)).toBe('2026-07-03');
  });

  it('utilise Europe/Paris sans fuseau, ou avec un fuseau inconnu', () => {
    const now = new Date('2026-07-02T22:30:00.000Z');
    expect(DEFAULT_RESTAURANT_TIMEZONE).toBe('Europe/Paris');
    expect(todayInTimezone(undefined, now)).toBe('2026-07-03');
    expect(todayInTimezone('Pas/UnFuseau', now)).toBe('2026-07-03');
  });

  it('lit l’horloge quand `now` n’est pas fourni', () => {
    expect(todayInTimezone('Europe/Paris')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
