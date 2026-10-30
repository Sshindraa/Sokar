import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../../shared/db/client';
import { computeTonight } from '../tonight';

vi.mock('../../../shared/db/client', () => ({
  db: {
    reservation: { findMany: vi.fn(), groupBy: vi.fn() },
    waitingListEntry: { findMany: vi.fn() },
  },
}));

// Vendredi 30 octobre 2026, heure de Paris = UTC + 1.
const LUNCH_MORNING = new Date('2026-10-30T08:00:00Z');
const AFTER_SPLIT = new Date('2026-10-30T15:00:00Z');

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'res-1',
    reservedAt: new Date('2026-10-30T11:30:00Z'),
    customerName: 'Camille Dupont',
    partySize: 2,
    customerId: null,
    confirmationStatus: 'CONFIRMED',
    tableId: 'table-1',
    specialRequests: null,
    customer: null,
    ...overrides,
  };
}

interface Fixtures {
  day?: ReturnType<typeof reservation>[];
  usual?: Array<{ reservedAt: Date; partySize: number }>;
  noShows?: Array<{ customerId: string | null }>;
  honored?: Array<{ customerId: string | null; _count: { _all: number } }>;
  waitlist?: Array<{ slotStart: Date }>;
}

/** Répond à chaque requête selon son filtre : jour du service, historique, absences, fidélité. */
function mockDb({ day = [], usual = [], noShows = [], honored = [], waitlist = [] }: Fixtures) {
  vi.mocked(db.reservation.findMany).mockImplementation((async (args: {
    where: { state?: unknown };
  }) => {
    const state = args.where.state;
    if (state === 'NO_SHOW') return noShows;
    if (typeof state === 'object' && state !== null && 'in' in state) {
      return (state as { in: string[] }).in.includes('PENDING') ? day : usual;
    }
    throw new Error('requête inattendue');
  }) as never);
  vi.mocked(db.reservation.groupBy).mockResolvedValue(honored as never);
  vi.mocked(db.waitingListEntry.findMany).mockResolvedValue(waitlist as never);
}

describe('computeTonight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('répond midi avant 16 h à Paris et soir à partir de 16 h', async () => {
    mockDb({});
    expect((await computeTonight('r1', LUNCH_MORNING)).service).toBe('midi');
    expect((await computeTonight('r1', AFTER_SPLIT)).service).toBe('soir');
  });

  it('classe une réservation à 15 h 59 au midi et à 16 h au soir', async () => {
    mockDb({
      day: [
        reservation({ id: 'lunch', reservedAt: new Date('2026-10-30T14:59:00Z'), partySize: 4 }),
        reservation({ id: 'dinner', reservedAt: new Date('2026-10-30T15:00:00Z'), partySize: 6 }),
      ],
    });

    const lunch = await computeTonight('r1', LUNCH_MORNING);
    expect(lunch.covers).toBe(4);
    expect(lunch.watch).toEqual([]);

    const dinner = await computeTonight('r1', AFTER_SPLIT);
    expect(dinner.covers).toBe(6);
    expect(dinner.watch.map((row) => row.reservationId)).toEqual(['dinner']);
  });

  it('signale une réservation non confirmée, sans table ou en grande tablée', async () => {
    mockDb({
      day: [
        reservation({ id: 'a', confirmationStatus: 'NO_REPLY' }),
        reservation({ id: 'b', tableId: null }),
        reservation({ id: 'c', partySize: 6 }),
        reservation({ id: 'd', confirmationStatus: 'CONFIRMED' }),
      ],
    });

    const card = await computeTonight('r1', LUNCH_MORNING);
    expect(card.watch).toEqual([
      expect.objectContaining({ reservationId: 'a', reasons: ['unconfirmed'] }),
      expect.objectContaining({ reservationId: 'b', reasons: ['noTable'] }),
      expect.objectContaining({ reservationId: 'c', reasons: ['largeParty'] }),
    ]);
  });

  it('signale un client déjà absent dans les 12 derniers mois, jamais un client sans identifiant', async () => {
    mockDb({
      day: [
        reservation({ id: 'absent', customerId: 'c1' }),
        reservation({ id: 'anonyme', customerId: null }),
      ],
      noShows: [{ customerId: 'c1' }],
    });

    const card = await computeTonight('r1', LUNCH_MORNING);
    expect(card.watch).toEqual([
      expect.objectContaining({ reservationId: 'absent', reasons: ['pastNoShow'] }),
    ]);
    const noShowQuery = vi
      .mocked(db.reservation.findMany)
      .mock.calls.find(
        ([args]) => (args as { where: { state?: unknown } }).where.state === 'NO_SHOW',
      );
    expect(noShowQuery?.[0]).toMatchObject({
      where: { customerId: { in: ['c1'] }, reservedAt: { lt: expect.any(Date) } },
    });
  });

  it('met en attention un client VIP et un client régulier, sans les mêler aux alertes', async () => {
    mockDb({
      day: [
        reservation({ id: 'vip', customer: { isVip: true } }),
        reservation({ id: 'regular', customerId: 'c2' }),
        reservation({ id: 'neither', customerId: 'c3' }),
      ],
      honored: [
        { customerId: 'c2', _count: { _all: 3 } },
        { customerId: 'c3', _count: { _all: 2 } },
      ],
    });

    const card = await computeTonight('r1', LUNCH_MORNING);
    expect(card.attention).toEqual([
      expect.objectContaining({ reservationId: 'vip', reasons: ['vip'] }),
      expect.objectContaining({ reservationId: 'regular', reasons: ['regular'] }),
    ]);
    expect(card.watch).toEqual([]);
  });

  it('ne lit ni absences ni fidélité sans identifiant client', async () => {
    mockDb({ day: [reservation({ customerId: null })] });

    await computeTonight('r1', LUNCH_MORNING);

    expect(db.reservation.groupBy).not.toHaveBeenCalled();
    const states = vi
      .mocked(db.reservation.findMany)
      .mock.calls.map(([args]) => (args as { where: { state?: unknown } }).where.state);
    expect(states).not.toContain('NO_SHOW');
  });

  it('calcule les couverts habituels du même service et du même jour de semaine', async () => {
    mockDb({
      usual: [
        // Vendredis précédents, midi : 10 et 20 couverts, moyenne 15.
        { reservedAt: new Date('2026-10-23T11:30:00Z'), partySize: 10 },
        { reservedAt: new Date('2026-10-16T11:00:00Z'), partySize: 20 },
        // Vendredi soir et autre jour : ignorés pour le midi.
        { reservedAt: new Date('2026-10-23T18:00:00Z'), partySize: 50 },
        { reservedAt: new Date('2026-10-22T11:30:00Z'), partySize: 50 },
      ],
    });

    expect((await computeTonight('r1', LUNCH_MORNING)).usualCovers).toBe(15);
  });

  it('renvoie usualCovers à null sans historique', async () => {
    mockDb({ usual: [] });

    expect((await computeTonight('r1', LUNCH_MORNING)).usualCovers).toBeNull();
  });
});
