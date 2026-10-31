import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../shared/db/client';
import { computeQueryData } from '../query-data';

vi.mock('../../../shared/db/client', () => ({
  db: {
    reservation: { findMany: vi.fn() },
    call: { findMany: vi.fn() },
    restaurant: { findUniqueOrThrow: vi.fn() },
  },
}));

// Réservations honorées à ces dates : la lecture filtre par reservedAt, comme la vraie requête.
function reservations(dates: string[], channel = 'WEB') {
  return dates.map((date) => ({
    reservedAt: new Date(date),
    createdAt: new Date(date),
    state: 'HONORED',
    channel,
    source: null,
    partySize: 2,
    estimatedRevenue: 50,
    confirmedRevenue: null,
  }));
}

function serveFrom(rows: ReturnType<typeof reservations>) {
  vi.mocked(db.reservation.findMany).mockImplementation((async (args: {
    where: { reservedAt: { gte: Date; lt: Date } };
  }) =>
    rows.filter(
      (row) =>
        row.reservedAt >= args.where.reservedAt.gte && row.reservedAt < args.where.reservedAt.lt,
    )) as never);
}

const base = { entity: 'reservations', metric: 'count', date_field: 'service' } as const;

describe('computeQueryData : compare', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('previous_period compare la période à une période de même durée juste avant', async () => {
    serveFrom([
      ...reservations(['2026-10-05T12:00:00Z', '2026-10-06T12:00:00Z', '2026-10-07T12:00:00Z']),
      ...reservations(['2026-09-05T12:00:00Z', '2026-09-06T12:00:00Z']),
    ]);

    const result = await computeQueryData('r1', {
      ...base,
      from: '2026-10-01',
      to: '2026-10-30',
      compare: 'previous_period',
    });

    expect(result).toMatchObject({
      total: { value: 3, reference: 2, delta: 1, delta_pct: 50 },
    });
  });

  it('last_year compare les mêmes dates un an avant', async () => {
    serveFrom([
      ...reservations(['2026-10-05T12:00:00Z', '2026-10-06T12:00:00Z', '2026-10-07T12:00:00Z']),
      ...reservations(['2025-10-05T12:00:00Z']),
    ]);

    const result = await computeQueryData('r1', {
      ...base,
      from: '2026-10-01',
      to: '2026-10-30',
      compare: 'last_year',
    });

    expect(result).toMatchObject({
      total: { value: 3, reference: 1, delta: 2, delta_pct: 200 },
    });
  });

  it('usual compare un jour à la moyenne des 4 mêmes jours de semaine précédents', async () => {
    // Mardi 27 octobre 2026 : mardis 20, 13, 6 et 29 septembre.
    serveFrom([
      ...reservations([
        '2026-10-27T12:00:00Z',
        '2026-10-27T13:00:00Z',
        '2026-10-27T19:00:00Z',
        '2026-10-27T20:00:00Z',
      ]),
      ...reservations(['2026-10-20T12:00:00Z', '2026-10-20T13:00:00Z']),
      ...reservations([
        '2026-10-13T12:00:00Z',
        '2026-10-13T13:00:00Z',
        '2026-10-13T19:00:00Z',
        '2026-10-13T20:00:00Z',
      ]),
      ...reservations(['2026-09-29T12:00:00Z', '2026-09-29T13:00:00Z']),
    ]);

    const result = await computeQueryData('r1', {
      ...base,
      from: '2026-10-27',
      to: '2026-10-27',
      compare: 'usual',
    });

    // Références : 2, 4, 0 et 2 : moyenne 2 ; écart 2 ; pourcentage 100.
    expect(result).toMatchObject({
      total: { value: 4, reference: 2, delta: 2, delta_pct: 100 },
    });
  });

  it('donne delta_pct null quand la référence vaut 0', async () => {
    serveFrom(
      reservations(['2026-10-05T12:00:00Z', '2026-10-06T12:00:00Z', '2026-10-07T12:00:00Z']),
    );

    const result = await computeQueryData('r1', {
      ...base,
      from: '2026-10-01',
      to: '2026-10-30',
      compare: 'previous_period',
    });

    expect(result).toMatchObject({
      total: { value: 3, reference: 0, delta: 3, delta_pct: null },
    });
  });

  it('compare chaque groupe à sa référence', async () => {
    serveFrom([
      ...reservations(['2026-10-05T12:00:00Z']),
      ...reservations(['2026-10-06T12:00:00Z'], 'PHONE'),
      ...reservations(['2026-09-05T12:00:00Z']),
    ]);

    const result = await computeQueryData('r1', {
      ...base,
      from: '2026-10-01',
      to: '2026-10-30',
      group_by: 'channel',
      compare: 'previous_period',
    });

    expect(result).toMatchObject({
      groups: expect.arrayContaining([
        { key: 'website', value: 1, reference: 1, delta: 0, delta_pct: 0 },
        { key: 'phone', value: 1, reference: 0, delta: 1, delta_pct: null },
      ]),
    });
  });

  it('refuse usual sur une période qui n’est ni un jour ni une semaine', async () => {
    const result = await computeQueryData('r1', {
      ...base,
      from: '2026-10-01',
      to: '2026-10-03',
      compare: 'usual',
    });

    expect(result).toMatchObject({ error: 'invalid_query' });
    expect(db.reservation.findMany).not.toHaveBeenCalled();
  });
});
