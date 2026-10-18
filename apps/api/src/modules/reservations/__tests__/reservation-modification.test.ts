import { afterEach, describe, expect, it, vi } from 'vitest';
import { modificationAccess } from '../reservation-modification';
import { snapshotCancellationPolicy } from '../../../shared/reservations/cancellation-policy';
const row = {
  id: 'booking',
  restaurantId: 'restaurant',
  tableId: 'table',
  state: 'CONFIRMED',
  createdAt: new Date(),
  startsAt: new Date('2099-06-05T17:00:00Z'),
  reservedAt: new Date('2099-06-05T17:00:00Z'),
  partySize: 2,
  cancellationPolicySnap: snapshotCancellationPolicy(
    { cancellationPolicy: "Annulation gratuite jusqu'à 24 heures avant le service." },
    'test',
  ),
  giftCardRedemptionSnap: null,
  _count: {
    reservationPayments: 0,
    giftCardRedemptions: 0,
    experienceReservations: 0,
    eventOrders: 0,
    distributionReservationLinks: 0,
  },
};
afterEach(() => vi.unstubAllEnvs());
describe('personal modification eligibility', () => {
  it('is off by default and independent from the cancellation flag', () => {
    vi.stubEnv('RESERVATION_SELF_MODIFICATION_ENABLED', 'false');
    expect(modificationAccess(row, 'bearer', 'Europe/Paris').available).toBe(false);
    vi.stubEnv('RESERVATION_SELF_MODIFICATION_ENABLED', 'true');
    vi.stubEnv('RESERVATION_SELF_CANCELLATION_ENABLED', 'false');
    expect(modificationAccess(row, 'bearer', 'Europe/Paris').available).toBe(true);
  });
  it('requires an active physical table and automatic acceptance', () => {
    vi.stubEnv('RESERVATION_SELF_MODIFICATION_ENABLED', 'true');
    expect(modificationAccess({ ...row, tableId: null }, 'bearer', 'Europe/Paris').available).toBe(
      false,
    );
    expect(modificationAccess(row, 'bearer', 'Europe/Paris', true).available).toBe(false);
    expect(
      modificationAccess({ ...row, state: 'CANCELLED' }, 'bearer', 'Europe/Paris').available,
    ).toBe(false);
  });
  it('respects frozen conditions and excludes financial bookings', () => {
    vi.stubEnv('RESERVATION_SELF_MODIFICATION_ENABLED', 'true');
    expect(
      modificationAccess({ ...row, cancellationPolicySnap: null }, 'bearer', 'Europe/Paris')
        .available,
    ).toBe(false);
    expect(
      modificationAccess(
        { ...row, _count: { ...row._count, reservationPayments: 1 } },
        'bearer',
        'Europe/Paris',
      ).available,
    ).toBe(false);
    expect(
      modificationAccess(
        { ...row, startsAt: new Date(Date.now() + 3600000) },
        'bearer',
        'Europe/Paris',
      ).available,
    ).toBe(false);
  });
});
