import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES,
  INSUFFICIENT_LEAD_TIME,
  formatLeadTime,
  isSlotTooSoon,
  isSlotTooSoonAt,
  leadTimeMessage,
  leadTimeRefusal,
  loadMinLeadTimeMinutes,
} from '../lead-time';

const NOW = new Date('2026-07-02T13:00:00.000Z'); // 15:00 à Paris
const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('isSlotTooSoon : la règle unique du délai minimum', () => {
  it('sans délai (0), seul le passé est trop proche : maintenant l’est, une milliseconde après non', () => {
    expect(isSlotTooSoon(minutesFromNow(-30), 0, NOW)).toBe(true);
    expect(isSlotTooSoon(NOW, 0, NOW)).toBe(true);
    expect(isSlotTooSoon(new Date(NOW.getTime() + 1), 0, NOW)).toBe(false);
    expect(isSlotTooSoon(minutesFromNow(10), 0, NOW)).toBe(false);
  });

  it('avec 30 min : trop proche en dessous de 30 min, réservable à 30 min pile', () => {
    expect(isSlotTooSoon(minutesFromNow(29), 30, NOW)).toBe(true);
    expect(isSlotTooSoon(new Date(minutesFromNow(30).getTime() - 1), 30, NOW)).toBe(true);
    expect(isSlotTooSoon(minutesFromNow(30), 30, NOW)).toBe(false);
    expect(isSlotTooSoon(minutesFromNow(31), 30, NOW)).toBe(false);
  });

  it('avec 2 h : la limite exacte est maintenant + 2 h', () => {
    expect(isSlotTooSoon(minutesFromNow(90), 120, NOW)).toBe(true);
    expect(isSlotTooSoon(minutesFromNow(119), 120, NOW)).toBe(true);
    expect(isSlotTooSoon(minutesFromNow(120), 120, NOW)).toBe(false);
    expect(isSlotTooSoon(minutesFromNow(121), 120, NOW)).toBe(false);
  });

  it('un créneau passé est toujours trop proche, quel que soit le délai', () => {
    for (const lead of [0, 30, 120, 1440]) {
      expect(isSlotTooSoon(minutesFromNow(-1), lead, NOW)).toBe(true);
    }
  });

  it('ignore un délai négatif ou invalide : retombe sur la règle du passé', () => {
    expect(isSlotTooSoon(minutesFromNow(5), -60, NOW)).toBe(false);
    expect(isSlotTooSoon(minutesFromNow(5), Number.NaN, NOW)).toBe(false);
    expect(isSlotTooSoon(minutesFromNow(-5), -60, NOW)).toBe(true);
  });

  it('lit l’horloge quand `now` n’est pas fourni', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      expect(isSlotTooSoon(minutesFromNow(60), 120)).toBe(true);
      expect(isSlotTooSoon(minutesFromNow(120), 120)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isSlotTooSoonAt : date et heure locales du restaurant', () => {
  it('convertit dans le fuseau du restaurant : 17:00 à Paris est exactement maintenant + 2 h', () => {
    expect(isSlotTooSoonAt('2026-07-02', '16:30', 'Europe/Paris', 120, NOW)).toBe(true);
    expect(isSlotTooSoonAt('2026-07-02', '17:00', 'Europe/Paris', 120, NOW)).toBe(false);
  });

  it('ne dépend pas du fuseau de l’appelant : 17:00 à New York est dans 6 h', () => {
    expect(isSlotTooSoonAt('2026-07-02', '17:00', 'America/New_York', 120, NOW)).toBe(false);
    expect(isSlotTooSoonAt('2026-07-02', '10:30', 'America/New_York', 120, NOW)).toBe(true);
  });

  it('traverse minuit : à 23:30 avec 2 h, 00:30 le lendemain est trop proche, 01:30 non', () => {
    const lateNow = new Date('2026-07-02T21:30:00.000Z'); // 23:30 à Paris
    expect(isSlotTooSoonAt('2026-07-03', '00:30', 'Europe/Paris', 120, lateNow)).toBe(true);
    expect(isSlotTooSoonAt('2026-07-03', '01:30', 'Europe/Paris', 120, lateNow)).toBe(false);
  });
});

describe('messages', () => {
  it('formate la durée : minutes, heures, heures et minutes', () => {
    expect(formatLeadTime(30)).toBe('30 min');
    expect(formatLeadTime(59)).toBe('59 min');
    expect(formatLeadTime(60)).toBe('1 h');
    expect(formatLeadTime(90)).toBe('1 h 30');
    expect(formatLeadTime(120)).toBe('2 h');
    expect(formatLeadTime(1440)).toBe('24 h');
  });

  it('écrit le message au client en français, au vouvoiement', () => {
    expect(leadTimeMessage(120)).toBe(
      'Ce créneau est trop proche : ce restaurant accepte les réservations au moins 2 h à l’avance.',
    );
    expect(leadTimeMessage(30)).toBe(
      'Ce créneau est trop proche : ce restaurant accepte les réservations au moins 30 min à l’avance.',
    );
    expect(leadTimeMessage(120)).not.toMatch(/\btu\b|\bton\b|\bta\b|Insufficient|lead time/i);
  });

  it('sans délai, dit simplement que le créneau est passé', () => {
    expect(leadTimeMessage(0)).toBe('Ce créneau est déjà passé.');
  });

  it('le corps du 409 porte le message dans `error` et un code stable', () => {
    expect(leadTimeRefusal(120)).toEqual({
      error:
        'Ce créneau est trop proche : ce restaurant accepte les réservations au moins 2 h à l’avance.',
      code: 'INSUFFICIENT_LEAD_TIME',
      minLeadTimeMinutes: 120,
    });
    expect(INSUFFICIENT_LEAD_TIME).toBe('INSUFFICIENT_LEAD_TIME');
  });
});

describe('loadMinLeadTimeMinutes', () => {
  const prismaReturning = (value: unknown) => ({
    restaurantExposureSettings: { findUnique: vi.fn().mockResolvedValue(value) },
  });

  it('lit le délai réglé par le restaurant', async () => {
    const prisma = prismaReturning({ minLeadTimeMinutes: 120 });
    expect(await loadMinLeadTimeMinutes(prisma as never, 'r1')).toBe(120);
    expect(prisma.restaurantExposureSettings.findUnique).toHaveBeenCalledWith({
      where: { restaurantId: 'r1' },
      select: { minLeadTimeMinutes: true },
    });
  });

  it('accepte un délai de 0 réglé volontairement', async () => {
    expect(
      await loadMinLeadTimeMinutes(prismaReturning({ minLeadTimeMinutes: 0 }) as never, 'r1'),
    ).toBe(0);
  });

  it('retombe sur 30 min sans réglages', async () => {
    expect(await loadMinLeadTimeMinutes(prismaReturning(null) as never, 'r1')).toBe(
      DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES,
    );
    expect(DEFAULT_ONLINE_MIN_LEAD_TIME_MINUTES).toBe(30);
  });
});
