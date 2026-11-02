import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../shared/db/client';
import { computeCallStats, isWithinOpeningHours } from '../call-stats';

vi.mock('../../../shared/db/client', () => ({
  db: {
    restaurant: { findUniqueOrThrow: vi.fn() },
    call: { findMany: vi.fn() },
  },
}));

// Lundi 12 h-14 h ; vendredi 18 h jusqu'à 1 h du matin (fermeture après minuit).
const HOURS = {
  mon: { open: '12:00', close: '14:00' },
  fri: { open: '18:00', close: '01:00' },
};

// Novembre : Paris est à UTC+1.
const LUNDI_12H30 = new Date('2026-11-02T11:30:00Z');
const LUNDI_11H = new Date('2026-11-02T10:00:00Z');
const LUNDI_14H30 = new Date('2026-11-02T13:30:00Z');
const MARDI_12H30 = new Date('2026-11-03T11:30:00Z');
const VENDREDI_23H30 = new Date('2026-11-06T22:30:00Z');
const SAMEDI_0H30 = new Date('2026-11-06T23:30:00Z');
const SAMEDI_1H = new Date('2026-11-07T00:00:00Z');
const SAMEDI_1H30 = new Date('2026-11-07T00:30:00Z');

describe('isWithinOpeningHours', () => {
  it('reconnaît un instant dans une période', () => {
    expect(isWithinOpeningHours(LUNDI_12H30, HOURS)).toBe(true);
  });

  it('refuse un instant avant l’ouverture', () => {
    expect(isWithinOpeningHours(LUNDI_11H, HOURS)).toBe(false);
  });

  it('refuse un instant après la fermeture', () => {
    expect(isWithinOpeningHours(LUNDI_14H30, HOURS)).toBe(false);
  });

  it('refuse un jour fermé', () => {
    expect(isWithinOpeningHours(MARDI_12H30, HOURS)).toBe(false);
  });

  it('suit une fermeture après minuit, jusqu’à 1 h exclue', () => {
    expect(isWithinOpeningHours(VENDREDI_23H30, HOURS)).toBe(true);
    expect(isWithinOpeningHours(SAMEDI_0H30, HOURS)).toBe(true);
    expect(isWithinOpeningHours(SAMEDI_1H, HOURS)).toBe(false);
    expect(isWithinOpeningHours(SAMEDI_1H30, HOURS)).toBe(false);
  });
});

describe('computeCallStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Les champs callerPhone et transcript existent en base : ils ne doivent jamais sortir.
  const calls = [
    {
      createdAt: LUNDI_12H30,
      intent: 'RESERVATION',
      outcome: 'RESERVED',
      durationSec: 120,
      callerPhone: '+33639981000',
      transcript: 'Bonjour',
    },
    {
      createdAt: new Date('2026-11-02T02:00:00Z'),
      intent: 'HOURS',
      outcome: 'INFO',
      durationSec: 60,
    },
    { createdAt: new Date('2026-11-02T11:45:00Z'), intent: null, outcome: null, durationSec: null },
    {
      createdAt: new Date('2026-11-02T11:50:00Z'),
      intent: 'CANCEL',
      outcome: 'HANDOFF',
      durationSec: 30,
    },
  ];

  it('compte les appels par intention et par résultat, avec les appels non terminés', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: HOURS } as never);
    vi.mocked(db.call.findMany).mockResolvedValue(calls as never);

    const stats = await computeCallStats('r1', '7d');

    expect(stats).toEqual({
      period: '7d',
      total: 4,
      byIntent: { RESERVATION: 1, HOURS: 1, MENU: 0, CANCEL: 1, OTHER: 0, unknown: 1 },
      byOutcome: {
        RESERVED: 1,
        INFO: 1,
        MESSAGE: 0,
        NO_ACTION: 0,
        HANDOFF: 1,
        ERROR: 0,
        unfinished: 1,
      },
      afterHours: 1,
      avgDurationSec: 70,
    });
  });

  it('ne lit que la date, l’intention, le résultat et la durée', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: HOURS } as never);
    vi.mocked(db.call.findMany).mockResolvedValue(calls as never);

    const stats = await computeCallStats('r1', '30d');

    expect(db.call.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { createdAt: true, intent: true, outcome: true, durationSec: true },
      }),
    );
    expect(JSON.stringify(stats)).not.toMatch(/callerPhone|transcript/);
  });

  it('donne une durée moyenne nulle sans durée connue, et des appels hors horaires nuls sans horaires', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: null } as never);
    vi.mocked(db.call.findMany).mockResolvedValue([
      { createdAt: LUNDI_12H30, intent: null, outcome: null, durationSec: null },
    ] as never);

    const stats = await computeCallStats('r1', 'today');

    expect(stats.avgDurationSec).toBeNull();
    expect(stats.afterHours).toBeNull();
    expect(stats.total).toBe(1);
  });
});
