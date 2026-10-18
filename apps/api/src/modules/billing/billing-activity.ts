import { db } from '../../shared/db/client';
import type { ActivityRecap } from './billing-notification-emails';

/** Activité du restaurant depuis `since` : appels reçus et réservations prises (hors annulées). */
export async function loadActivityRecap(restaurantId: string, since: Date): Promise<ActivityRecap> {
  const createdAt = { gte: since };
  const [calls, reservations, phoneReservations] = await Promise.all([
    db.call.count({ where: { restaurantId, createdAt } }),
    db.reservation.aggregate({
      where: { restaurantId, createdAt, status: { not: 'CANCELLED' } },
      _count: { _all: true },
      _sum: { partySize: true },
    }),
    db.reservation.count({
      where: { restaurantId, createdAt, status: { not: 'CANCELLED' }, channel: 'PHONE' },
    }),
  ]);
  return {
    calls,
    reservations: reservations._count._all,
    covers: reservations._sum.partySize ?? 0,
    phoneReservations,
  };
}
