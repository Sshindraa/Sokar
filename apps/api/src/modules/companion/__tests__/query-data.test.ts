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

const HOURS = { mon: { open: '12:00', close: '14:00' } };
const FORBIDDEN_FIELDS = [
  'customerName',
  'customerPhone',
  'customerEmail',
  'customerId',
  'notes',
  'callerPhone',
  'transcript',
];

function reservation(overrides: Record<string, unknown>) {
  return {
    reservedAt: new Date('2026-10-24T19:00:00Z'),
    createdAt: new Date('2026-10-20T10:00:00Z'),
    state: 'HONORED',
    channel: 'WEB',
    source: null,
    partySize: 2,
    estimatedRevenue: 60,
    confirmedRevenue: null,
    ...overrides,
  };
}

describe('computeQueryData : validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const base = { entity: 'reservations', metric: 'count', date_field: 'service' };

  it.each([
    ['entité inconnue', { ...base, entity: 'tickets', from: '2026-10-01', to: '2026-10-02' }],
    [
      'mesure d’appel sur les réservations',
      { ...base, metric: 'avg_duration_sec', from: '2026-10-01', to: '2026-10-02' },
    ],
    ['to avant from', { ...base, from: '2026-10-25', to: '2026-10-24' }],
    ['plus de 400 jours', { ...base, from: '2025-01-01', to: '2026-06-01' }],
    [
      'regroupement par jour sur plus de 62 jours',
      { ...base, group_by: 'day', from: '2026-01-01', to: '2026-03-10' },
    ],
    ['champ en trop', { ...base, from: '2026-10-01', to: '2026-10-02', phone: '+33612345678' }],
    ['date inexistante', { ...base, from: '2026-02-31', to: '2026-03-01' }],
  ])('renvoie invalid_query pour %s', async (_, input) => {
    const result = await computeQueryData('r1', input);

    expect(result).toMatchObject({ error: 'invalid_query' });
    expect(db.reservation.findMany).not.toHaveBeenCalled();
  });
});

describe('computeQueryData : bornes de Paris', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.reservation.findMany).mockResolvedValue([] as never);
  });

  it('couvre le jour de Paris, minuit à minuit (heure d’hiver)', async () => {
    await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'count',
      date_field: 'service',
      from: '2026-10-24',
      to: '2026-10-24',
    });

    const where = vi.mocked(db.reservation.findMany).mock.calls[0][0]!.where as {
      reservedAt: { gte: Date; lt: Date };
    };
    expect(where.reservedAt.gte).toEqual(new Date('2026-10-23T22:00:00Z'));
    expect(where.reservedAt.lt).toEqual(new Date('2026-10-24T22:00:00Z'));
  });

  it('couvre le jour du changement d’heure (25/10/2026, 25 heures)', async () => {
    await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'count',
      date_field: 'service',
      from: '2026-10-25',
      to: '2026-10-25',
    });

    const where = vi.mocked(db.reservation.findMany).mock.calls[0][0]!.where as {
      reservedAt: { gte: Date; lt: Date };
    };
    expect(where.reservedAt.gte).toEqual(new Date('2026-10-24T22:00:00Z'));
    expect(where.reservedAt.lt).toEqual(new Date('2026-10-25T23:00:00Z'));
  });

  it('range une réservation de 23 h 30 à Paris dans le jour de Paris', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      reservation({ reservedAt: new Date('2026-10-24T21:30:00Z') }),
      reservation({ reservedAt: new Date('2026-10-24T22:30:00Z') }),
    ] as never);

    const result = await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'count',
      date_field: 'service',
      group_by: 'day',
      from: '2026-10-24',
      to: '2026-10-25',
    });

    expect(result).toMatchObject({
      total: 2,
      groups: [
        { key: '2026-10-24', value: 1 },
        { key: '2026-10-25', value: 1 },
      ],
    });
  });
});

describe('computeQueryData : regroupements et filtres', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('range les jours de semaine de lundi à dimanche', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      reservation({ reservedAt: new Date('2026-11-01T12:00:00Z') }), // dimanche
      reservation({ reservedAt: new Date('2026-11-02T12:00:00Z') }), // lundi
    ] as never);

    const result = await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'count',
      date_field: 'service',
      group_by: 'weekday',
      from: '2026-11-01',
      to: '2026-11-02',
    });

    expect(result).toMatchObject({
      groups: [
        { key: 'lundi', value: 1 },
        { key: 'dimanche', value: 1 },
      ],
    });
  });

  it('groupe par canal avec reservationChannelGroup', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([
      reservation({ channel: 'PHONE' }),
      reservation({ channel: 'WEB', source: 'google' }),
      reservation({ channel: 'MCP' }),
    ] as never);

    const result = await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'covers',
      date_field: 'service',
      group_by: 'channel',
      from: '2026-10-24',
      to: '2026-10-24',
    });

    expect(result).toMatchObject({
      total: 6,
      groups: expect.arrayContaining([
        { key: 'phone', value: 2 },
        { key: 'google', value: 2 },
        { key: 'ai', value: 2 },
      ]),
    });
  });

  it('prend les états valables par défaut', async () => {
    vi.mocked(db.reservation.findMany).mockResolvedValue([] as never);

    const result = await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'count',
      date_field: 'created',
      from: '2026-10-24',
      to: '2026-10-24',
    });

    const where = vi.mocked(db.reservation.findMany).mock.calls[0][0]!.where as {
      state: { in: string[] };
    };
    expect(where.state.in).toEqual(['CONFIRMED', 'SEATED', 'HONORED']);
    expect(result).toMatchObject({
      query: { filters: { states: ['CONFIRMED', 'SEATED', 'HONORED'] } },
    });
  });

  it('compte les appels hors horaires', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: HOURS } as never);
    vi.mocked(db.call.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-11-02T11:30:00Z'),
        intent: 'HOURS',
        outcome: 'INFO',
        durationSec: 60,
      },
      {
        createdAt: new Date('2026-11-02T02:00:00Z'),
        intent: 'OTHER',
        outcome: 'MESSAGE',
        durationSec: null,
      },
    ] as never);

    const result = await computeQueryData('r1', {
      entity: 'calls',
      metric: 'count',
      group_by: 'after_hours',
      from: '2026-11-02',
      to: '2026-11-02',
    });

    expect(result).toMatchObject({
      total: 2,
      groups: [
        { key: 'pendant les horaires', value: 1 },
        { key: 'hors horaires', value: 1 },
      ],
    });
  });

  it('refuse le regroupement hors horaires sans horaires d’ouverture', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: null } as never);

    const result = await computeQueryData('r1', {
      entity: 'calls',
      metric: 'count',
      group_by: 'after_hours',
      from: '2026-11-02',
      to: '2026-11-02',
    });

    expect(result).toMatchObject({ error: 'invalid_query' });
  });

  it('donne une durée moyenne de 45 s, puis null sans durée connue', async () => {
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: HOURS } as never);
    vi.mocked(db.call.findMany).mockResolvedValue([
      { createdAt: new Date('2026-11-02T11:30:00Z'), intent: null, outcome: null, durationSec: 60 },
      { createdAt: new Date('2026-11-02T11:40:00Z'), intent: null, outcome: null, durationSec: 30 },
    ] as never);
    const query = {
      entity: 'calls',
      metric: 'avg_duration_sec',
      from: '2026-11-02',
      to: '2026-11-02',
    };

    expect(await computeQueryData('r1', query)).toMatchObject({ total: 45 });

    vi.mocked(db.call.findMany).mockResolvedValue([
      {
        createdAt: new Date('2026-11-02T11:30:00Z'),
        intent: null,
        outcome: null,
        durationSec: null,
      },
    ] as never);
    expect(await computeQueryData('r1', query)).toMatchObject({ total: null });
  });
});

describe('computeQueryData : champs lus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: HOURS } as never);
    vi.mocked(db.reservation.findMany).mockResolvedValue([] as never);
    vi.mocked(db.call.findMany).mockResolvedValue([] as never);
  });

  it('ne sélectionne aucun champ client, ni pour les réservations ni pour les appels', async () => {
    await computeQueryData('r1', {
      entity: 'reservations',
      metric: 'count',
      date_field: 'service',
      from: '2026-10-24',
      to: '2026-10-24',
    });
    await computeQueryData('r1', {
      entity: 'calls',
      metric: 'count',
      from: '2026-10-24',
      to: '2026-10-24',
    });

    const reservationSelect = Object.keys(
      vi.mocked(db.reservation.findMany).mock.calls[0][0]!.select!,
    );
    const callSelect = Object.keys(vi.mocked(db.call.findMany).mock.calls[0][0]!.select!);
    for (const field of FORBIDDEN_FIELDS) {
      expect(reservationSelect).not.toContain(field);
      expect(callSelect).not.toContain(field);
    }
  });
});
