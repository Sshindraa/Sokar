import { describe, expect, it } from 'vitest';
import type { Reservation, ServiceCard } from '@/types/api';
import { summarizeBriefing, upcomingReservations } from './briefing-summary';

function reservation(overrides: Partial<Reservation>): Reservation {
  return {
    id: 'r1',
    restaurantId: 'rest-1',
    reservedAt: '2026-10-27T19:30:00.000Z',
    partySize: 2,
    customerName: 'Alice',
    customerPhone: null,
    status: 'CONFIRMED',
    state: 'CONFIRMED',
    estimatedRevenue: null,
    tableId: null,
    ...overrides,
  };
}

function card(reservationId: string, kinds: ServiceCard['badges'][number]['kind'][]): ServiceCard {
  return {
    reservationId,
    customerId: `customer-${reservationId}`,
    lifecycle: null,
    badges: kinds.map((kind) => ({ kind, label: kind, detail: kind })),
  };
}

describe('upcomingReservations', () => {
  it('garde les réservations à servir, par heure', () => {
    const rows = upcomingReservations([
      reservation({ id: 'late', reservedAt: '2026-10-27T20:00:00.000Z' }),
      reservation({ id: 'cancelled', state: 'CANCELLED', status: 'CANCELLED' }),
      reservation({ id: 'no-show', state: 'NO_SHOW', status: 'NO_SHOW' }),
      reservation({
        id: 'early',
        reservedAt: '2026-10-27T18:30:00.000Z',
        state: 'SEATED',
        status: 'SEATED',
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['early', 'late']);
  });
});

describe('summarizeBriefing', () => {
  it('additionne les couverts et compte chaque signal une fois par réservation', () => {
    const summary = summarizeBriefing([
      {
        reservation: reservation({ id: 'r1', partySize: 4 }),
        card: card('r1', ['allergy', 'allergy', 'regular']),
      },
      {
        reservation: reservation({ id: 'r2', partySize: 2 }),
        card: card('r2', ['occasion', 'no_show_risk']),
      },
      { reservation: reservation({ id: 'r3', partySize: 3 }), card: undefined },
    ]);
    expect(summary).toEqual({
      reservations: 3,
      covers: 9,
      allergies: 1,
      regulars: 1,
      occasions: 1,
      noShowRisks: 1,
    });
  });
});
