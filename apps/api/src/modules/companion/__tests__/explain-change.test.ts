import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../shared/db/client';
import { evaluateCapability } from '../../entitlements/entitlement.service';
import { SOURCES } from '../catalog';
import { explainChange } from '../explain-change';

vi.mock('../../../shared/db/client', () => ({
  db: {
    reservation: { findMany: vi.fn() },
    call: { findMany: vi.fn() },
    waitingListEntry: { findMany: vi.fn() },
    reputationFeedback: { findMany: vi.fn() },
    restaurantExposureSettings: { findUnique: vi.fn() },
    restaurant: { findUniqueOrThrow: vi.fn() },
  },
}));
vi.mock('../../entitlements/entitlement.service', () => ({ evaluateCapability: vi.fn() }));

const at = (day: number, hour = 12) =>
  new Date(`2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00Z`);

// Lecture comme la vraie requête : filtrée par la colonne de date demandée.
function serve(rows: Array<Record<string, unknown> & { at: Date }>) {
  return (async (args: { where: Record<string, unknown> }) => {
    const key = ['reservedAt', 'createdAt', 'slotStart', 'submittedAt'].find(
      (k) => k in args.where,
    )!;
    const range = args.where[key] as { gte: Date; lt: Date };
    return rows.filter((row) => row.at >= range.gte && row.at < range.lt);
  }) as never;
}

const reservation = (when: Date, channel = 'WEB') => ({
  at: when,
  reservedAt: when,
  createdAt: when,
  state: 'HONORED',
  channel,
  source: null,
  partySize: 2,
  estimatedRevenue: 50,
  confirmedRevenue: null,
});
const call = (when: Date) => ({
  at: when,
  createdAt: when,
  intent: null,
  outcome: null,
  durationSec: 30,
});

// Le résultat d'une seule mesure : la requête donne measure, donc une entrée.
const firstMeasure = (result: unknown) =>
  (result as { measures: Array<Record<string, unknown>> }).measures[0];

const reservationsQuery = {
  source: 'reservations',
  measure: 'count',
  date_field: 'service',
  compare: 'previous_period',
  from: '2026-10-06',
  to: '2026-10-06',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(evaluateCapability).mockResolvedValue({ allowed: true } as never);
  vi.mocked(db.restaurantExposureSettings.findUnique).mockResolvedValue({
    capacitySpecials: { waitingListEnabled: true },
  } as never);
  vi.mocked(db.waitingListEntry.findMany).mockResolvedValue([] as never);
  vi.mocked(db.reputationFeedback.findMany).mockResolvedValue([] as never);
  vi.mocked(db.call.findMany).mockResolvedValue([] as never);
  vi.mocked(db.restaurant.findUniqueOrThrow).mockResolvedValue({ openingHours: null } as never);
});

describe('explainChange : total et drivers', () => {
  it('classe les groupes par écart absolu et donne leur part de l’écart total', async () => {
    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([
        reservation(at(6, 12), 'PHONE'),
        reservation(at(6, 13), 'PHONE'),
        reservation(at(6, 14), 'PHONE'),
        reservation(at(6, 15), 'PHONE'),
        reservation(at(6, 16)),
        reservation(at(6, 17)),
        reservation(at(5, 12), 'PHONE'),
        reservation(at(5, 13)),
      ]),
    );

    const result = await explainChange('r1', reservationsQuery);

    expect(firstMeasure(result)).toMatchObject({
      total: { value: 6, reference: 2, delta: 4, delta_pct: 200 },
    });
    const drivers = firstMeasure(result).drivers as Array<Record<string, unknown>>;
    expect(drivers[0]).toMatchObject({ dimension: 'state', key: 'HONORED', delta: 4, share: 1 });
    expect(drivers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: 'channel', key: 'phone', delta: 3, share: 0.75 }),
        expect.objectContaining({ dimension: 'channel', key: 'website', delta: 1, share: 0.25 }),
      ]),
    );
    expect(drivers.find((driver) => driver.dimension === 'channel')).toMatchObject({
      label: SOURCES.reservations.dimensions.channel.label,
    });
  });

  it('donne une part nulle à chaque groupe quand l’écart total vaut 0', async () => {
    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([reservation(at(6), 'PHONE'), reservation(at(5), 'PHONE')]),
    );

    const result = await explainChange('r1', reservationsQuery);

    const drivers = firstMeasure(result).drivers as Array<{ share: number | null; delta: number }>;
    expect(drivers.length).toBeGreaterThan(0);
    expect(drivers.every((driver) => driver.delta === 0 && driver.share === null)).toBe(true);
  });

  it('signale un volume faible quand la référence totale est inférieure à 5', async () => {
    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([reservation(at(6)), reservation(at(5))]),
    );
    expect(firstMeasure(await explainChange('r1', reservationsQuery))).toMatchObject({
      low_volume: true,
    });

    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([reservation(at(6)), ...Array.from({ length: 5 }, () => reservation(at(5)))]),
    );
    expect(firstMeasure(await explainChange('r1', reservationsQuery))).toMatchObject({
      low_volume: false,
    });
  });
});

describe('explainChange : sans measure', () => {
  it('explique chaque mesure de la fiche, couverts compris', async () => {
    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([reservation(at(6), 'PHONE'), reservation(at(6)), reservation(at(5))]),
    );

    const result = (await explainChange('r1', {
      source: 'reservations',
      compare: 'previous_period',
      date_field: 'service',
      from: '2026-10-06',
      to: '2026-10-06',
    })) as { measures: Array<{ measure: string; total: { value: number } }> };

    expect(result.measures.map((entry) => entry.measure)).toEqual([
      'count',
      'covers',
      'estimated_revenue',
    ]);
    const [count, covers] = result.measures;
    expect(count.total.value).toBe(2);
    expect(covers.total.value).toBe(4);
  });
});

describe('explainChange : alongside', () => {
  it('garde une autre source seulement si l’écart atteint 25 % et la référence 5', async () => {
    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([reservation(at(6)), reservation(at(5))]),
    );
    vi.mocked(db.call.findMany).mockImplementation(
      serve([
        ...Array.from({ length: 12 }, () => call(at(6))),
        ...Array.from({ length: 6 }, () => call(at(5))),
      ]),
    );

    const result = await explainChange('r1', reservationsQuery);

    expect((result as { alongside: unknown[] }).alongside).toEqual([
      { source: 'calls', label: SOURCES.calls.label, value: 12, reference: 6, delta_pct: 100 },
    ]);
  });

  it('écarte une variation de moins de 25 % ou une référence de moins de 5', async () => {
    vi.mocked(db.reservation.findMany).mockImplementation(
      serve([reservation(at(6)), reservation(at(5))]),
    );
    vi.mocked(db.call.findMany).mockImplementation(
      serve([
        ...Array.from({ length: 7 }, () => call(at(6))),
        ...Array.from({ length: 6 }, () => call(at(5))),
      ]),
    );
    expect(await explainChange('r1', reservationsQuery)).toMatchObject({ alongside: [] });

    vi.mocked(db.call.findMany).mockImplementation(
      serve([...Array.from({ length: 4 }, () => call(at(6))), call(at(5)), call(at(5))]),
    );
    expect(await explainChange('r1', reservationsQuery)).toMatchObject({ alongside: [] });
  });
});

describe('explainChange : bornes et formule', () => {
  it('renvoie unavailable plan quand la fiche demandée exige une formule absente', async () => {
    vi.mocked(evaluateCapability).mockResolvedValue({ allowed: false } as never);

    const result = await explainChange('r1', {
      source: 'feedback',
      measure: 'avg_score',
      date_field: 'submitted',
      compare: 'previous_period',
      from: '2026-10-06',
      to: '2026-10-06',
    });

    expect(result).toEqual({ unavailable: 'plan' });
    expect(db.reputationFeedback.findMany).not.toHaveBeenCalled();
  });

  it('refuse une fiche à plusieurs dates sans date_field', async () => {
    const result = await explainChange('r1', { ...reservationsQuery, date_field: undefined });

    expect(result).toMatchObject({ error: 'invalid_query' });
  });
});
