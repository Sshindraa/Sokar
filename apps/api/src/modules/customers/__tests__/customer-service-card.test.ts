import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildServiceCard, loadReservationServiceCards } from '../customer-service-card';

const db = vi.hoisted(() => ({
  reservation: { findMany: vi.fn() },
  restaurant: { findUnique: vi.fn() },
  customerPreference: { findMany: vi.fn() },
}));
vi.mock('../../../shared/db/client', () => ({ db }));

const now = new Date('2026-10-22T12:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);
const customer = { id: 'c1', birthMonth: null, birthDay: null, specialOccasion: null };

function card(overrides: Partial<Parameters<typeof buildServiceCard>[0]> = {}) {
  return buildServiceCard({
    reservationId: 'r1',
    reservationDate: new Date('2026-10-22T18:30:00.000Z'),
    specialRequests: null,
    customer,
    visitDates: [],
    noShows365d: 0,
    preferences: [],
    timezone: 'Europe/Paris',
    now,
    ...overrides,
  });
}

describe('buildServiceCard', () => {
  it('habitué, allergie confirmée, anniversaire et risque d’absence', () => {
    const result = card({
      customer: { ...customer, birthMonth: 10, birthDay: 23 },
      visitDates: [daysAgo(5), daysAgo(20), daysAgo(40)],
      noShows365d: 2,
      preferences: [
        {
          key: 'dietary_restrictions',
          value: 'Allergie aux arachides',
          source: 'MANUAL',
          confirmedAt: null,
          expiresAt: null,
        },
      ],
    });
    expect(result.lifecycle?.status).toBe('regular');
    expect(result.badges).toEqual([
      { kind: 'regular', label: 'Habitué', detail: '3 visites en 90 jours' },
      { kind: 'allergy', label: 'Allergie', detail: 'Allergie aux arachides' },
      { kind: 'occasion', label: 'Anniversaire', detail: 'Dans 1 j' },
      { kind: 'no_show_risk', label: '2 absences', detail: 'Absent 2 fois en 12 mois' },
    ]);
  });

  it('ne montre jamais une suggestion vocale non confirmée ni une préférence expirée', () => {
    const result = card({
      preferences: [
        {
          key: 'dietary_restrictions',
          value: 'végétarien',
          source: 'VOICE_SUGGESTION',
          confirmedAt: null,
          expiresAt: null,
        },
        {
          key: 'accessibility_needs',
          value: 'fauteuil',
          source: 'MANUAL',
          confirmedAt: null,
          expiresAt: daysAgo(1),
        },
      ],
    });
    expect(result.badges).toEqual([]);
  });

  it('une suggestion vocale confirmée devient un régime', () => {
    const result = card({
      preferences: [
        {
          key: 'dietary_restrictions',
          value: ['végétarien'],
          source: 'VOICE_SUGGESTION',
          confirmedAt: daysAgo(2),
          expiresAt: null,
        },
      ],
    });
    expect(result.badges).toEqual([{ kind: 'diet', label: 'Régime', detail: 'végétarien' }]);
  });

  it('occasion lue dans la demande, même sans fiche client', () => {
    const result = card({ customer: null, specialRequests: 'Dîner de fiançailles, gâteau' });
    expect(result).toEqual({
      reservationId: 'r1',
      customerId: null,
      lifecycle: null,
      badges: [{ kind: 'occasion', label: 'Fiançailles', detail: 'Indiqué dans la demande' }],
    });
  });

  it('pas d’anniversaire hors de la fenêtre de 3 jours', () => {
    expect(card({ customer: { ...customer, birthMonth: 10, birthDay: 26 } }).badges).toEqual([]);
  });
});

describe('loadReservationServiceCards', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lit toute la liste en requêtes groupées, toutes limitées au restaurant', async () => {
    db.reservation.findMany
      .mockResolvedValueOnce([
        {
          id: 'r1',
          startsAt: now,
          reservedAt: now,
          specialRequests: null,
          customer: { ...customer, restaurantId: 'rest-1', archivedAt: null },
        },
        {
          id: 'r2',
          startsAt: now,
          reservedAt: now,
          specialRequests: null,
          customer: { ...customer, id: 'c2', restaurantId: 'rest-1', archivedAt: null },
        },
      ])
      .mockResolvedValueOnce([
        {
          customerId: 'c1',
          state: 'NO_SHOW',
          status: 'NO_SHOW',
          startsAt: daysAgo(3),
          reservedAt: daysAgo(3),
        },
      ]);
    db.restaurant.findUnique.mockResolvedValue({ timezone: 'Europe/Paris' });
    db.customerPreference.findMany.mockResolvedValue([]);

    const cards = await loadReservationServiceCards('rest-1', ['r1', 'r2', 'r1'], now);

    expect(db.reservation.findMany).toHaveBeenCalledTimes(2);
    expect(db.customerPreference.findMany).toHaveBeenCalledTimes(1);
    expect(db.reservation.findMany.mock.calls[0][0].where).toEqual({
      restaurantId: 'rest-1',
      id: { in: ['r1', 'r2'] },
    });
    expect(db.reservation.findMany.mock.calls[1][0].where).toMatchObject({
      restaurantId: 'rest-1',
      customerId: { in: ['c1', 'c2'] },
    });
    expect(db.customerPreference.findMany.mock.calls[0][0].where).toMatchObject({
      restaurantId: 'rest-1',
      customerId: { in: ['c1', 'c2'] },
    });
    expect(cards.map((entry) => entry.badges.map((badge) => badge.kind))).toEqual([
      ['no_show_risk'],
      [],
    ]);
  });
});
